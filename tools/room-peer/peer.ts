// A fake room member for trying rooms with one computer: it announces itself, pings at random spots and prints
// the pings (and, with --emotes, the emotes) it receives. It speaks the real protocol, using the app's own modules.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { checkStill } from '../../src/main/emoteLibrary';
import { EmoteTransfer } from '../../src/main/emoteTransfer';
import { LanTransport } from '../../src/main/lanTransport';
import { RelayTransport } from '../../src/main/relayTransport';
import { deriveRoomKeys, open, seal } from '../../src/main/roomCrypto';
import { RateLimiter } from '../../src/main/rateLimiter';
import { RELAY_PING_BURST, RELAY_PING_RATE } from '../../src/main/roomManager';
import type { Transport } from '../../src/main/transport';
import { EMOTE_CATALOG } from '../../src/shared/emoteCatalog';
import { ALL_PINGS } from '../../src/shared/pings';
import { parseRoomCode } from '../../src/shared/roomCode';
import { decodeMessage, encodeMessage, PROTOCOL_VERSION, type RoomMessage } from '../../src/shared/roomProtocol';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string', default: 'Bot' },
    color: { type: 'string', default: '4' },
    rate: { type: 'string', default: '1' }, // pings per second; 0 = only listen
    host: { type: 'string', default: '127.0.0.1' }, // where lolPing runs
    port: { type: 'string', default: '47475' }, // this peer's own port (lolPing itself uses 47474)
    display: { type: 'string', default: '1' },
    relay: { type: 'boolean', default: false }, // through the public relays instead of the LAN
    emotes: { type: 'boolean', default: false }, // also send emotes, alternating with the pings
    image: { type: 'string' }, // a still .webp this peer owns: it announces and serves it, and its custom emote uses it
  },
});

const parsed = parseRoomCode(positionals.join(' '));
if (!parsed.ok) {
  console.error('usage: node tools/room-peer/run.mjs PING-XXXXX-XXXXX [--name Bot] [--color 0-7] [--rate 1] [--host 127.0.0.1] [--port 47475] [--display 1] [--relay] [--emotes] [--image still.webp]');
  process.exit(1);
}

const keys = await deriveRoomKeys(parsed.code);
const peer = randomBytes(8).toString('hex');
let seq = 0;
const packet = (body: Record<string, unknown>): Buffer =>
  seal(keys.msgKey, encodeMessage({ peer, seq: ++seq, ts: Date.now(), ...body } as RoomMessage));

// --image: the still must pass the same checks as an import, and its ID is its hash, as in the app.
const image = values.image ? new Uint8Array(readFileSync(values.image)) : null;
if (image && checkStill(image) !== null) {
  console.error(`--image must be a still WebP of at most 12,288 bytes and 160 px (${checkStill(image)})`);
  process.exit(1);
}
const imageHash = image ? createHash('sha256').update(image).digest('hex').slice(0, 32) : null;
const presence = (): Buffer =>
  packet({ t: 'presence', proto: PROTOCOL_VERSION, app: 'room-peer', name: values.name, color: Number(values.color), status: 'on',
    em: imageHash ? [imageHash] : [] });

const transport: Transport = values.relay
  ? new RelayTransport()
  : new LanTransport({ port: Number(values.port), seeds: [{ host: values.host!, port: 47474 }] });
const label = values.relay ? 'relay' : 'lan';
// Custom emote stills, both ways, through the app's own transfer logic: lolPing's announced stills are fetched and
// verified here, and --image is served to lolPing.
const received = new Set<string>();
const lanKeys = new Map<string, string>(); // member peer ID → the address its packets come from
const answered = new Set<string>();
const relayCap = new RateLimiter(Date.now);
const transfer = new EmoteTransfer({
  now: Date.now,
  have: (h) => h === imageHash || received.has(h),
  still: (h) => (h === imageHash ? image : null),
  announced: () => (imageHash ? [imageHash] : []),
  enabled: () => true,
  put: (h) => {
    received.add(h);
    console.log(`[in] still ${h} arrived and passed the hash and image checks`);
  },
  routeOf: (p) => (values.relay ? 'shared' : lanKeys.has(p) ? 'lan' : null),
  sendToLan: (p, body) => {
    const key = lanKeys.get(p);
    if (key) transport.sendTo(key, packet(body));
  },
  broadcastShared: (body) => transport.broadcast(packet(body)),
  spareSharedToken: (keep) =>
    relayCap.tokens('internet', RELAY_PING_RATE, RELAY_PING_BURST) >= keep + 1 && relayCap.allow('internet', RELAY_PING_RATE, RELAY_PING_BURST),
});
transport.on('status', (s) => console.log(`[${label}] ${s}`));
transport.on('packet', (from: string, data: Uint8Array) => {
  const plain = open(keys.msgKey, data);
  const msg = plain && decodeMessage(plain);
  if (!msg || msg.peer === peer) return;
  lanKeys.set(msg.peer, from);
  if (msg.t === 'want') {
    if (msg.to !== peer) return;
    console.log(`[in] want ${msg.h} ${msg.need.length ? `chunks ${msg.need.join(', ')}` : '(all chunks)'}`);
    transfer.onWant(msg);
  } else if (msg.t === 'chunk') transfer.onChunk(msg);
  else if (msg.t === 'ping') console.log(`[in] ${msg.ping} on display ${msg.d} at ${msg.x}, ${msg.y} from ${from}`);
  else if (msg.t === 'emote') console.log(`[in] emote ${msg.e} on display ${msg.d} at ${msg.x}, ${msg.y} from ${from}`);
  else if (msg.t === 'presence') {
    console.log(`[in] presence: ${msg.name} (${msg.status})${msg.em.length ? `, announces ${msg.em.join(', ')}` : ''}`);
    // Answer a new member straight away, as the app does: a second room-peer on another port hears no broadcast.
    if (!values.relay && !answered.has(msg.peer)) transport.sendTo(from, presence());
    answered.add(msg.peer);
    transfer.announced(msg.peer, msg.em);
  } else {
    console.log(`[in] bye from ${msg.peer}`);
    transfer.memberGone(msg.peer);
  }
});
transport.start(keys);

setInterval(() => transport.broadcast(presence()), values.relay ? 10_000 : 2000);
if (values.relay) transport.on('linkUp', () => transport.broadcast(presence())); // each relay as it comes up
else transport.once('status', () => transport.broadcast(presence()));
let rate = Number(values.rate);
if (values.relay && rate > RELAY_PING_RATE) {
  console.log(`[relay] --rate ${rate} is more than the relays should get; using ${RELAY_PING_RATE}`);
  rate = RELAY_PING_RATE;
}
const spot = (): [number, number] => [0.1 + Math.random() * 0.8, 0.1 + Math.random() * 0.8];
const sendEmote = (e: string): void => {
  const [x, y] = spot();
  transport.broadcast(packet({ t: 'emote', e, d: Number(values.display), x, y }));
  console.log(`[out] emote ${e} at ${x.toFixed(2)}, ${y.toFixed(2)}`);
};
if (rate > 0) {
  let n = 0;
  setInterval(() => {
    // With --emotes every other send is an emote, so the total stays at the ping rate.
    if (values.emotes && n++ % 2) return sendEmote(EMOTE_CATALOG[Math.floor(Math.random() * EMOTE_CATALOG.length)].slug);
    const ping = ALL_PINGS[Math.floor(Math.random() * ALL_PINGS.length)].id;
    const [x, y] = spot();
    transport.broadcast(packet({ t: 'ping', ping, d: Number(values.display), x, y }));
    console.log(`[out] ${ping} at ${x.toFixed(2)}, ${y.toFixed(2)}`);
  }, 1000 / rate);
  // Our --image, or a made-up custom emote: the app has no such image, so it shows the placeholder.
  if (values.emotes) setInterval(() => sendEmote(`c:${imageHash ?? randomBytes(16).toString('hex')}`), 10_000);
}
console.log(`room-peer "${values.name}" in room ${positionals.join(' ')} over ${values.relay ? 'the relays' : 'the LAN'} — Ctrl+C to leave`);
process.on('SIGINT', () => {
  transfer.stop();
  transport.broadcast(packet({ t: 'bye' }));
  transport.stop();
  void transport.whenClosed().then(() => process.exit(0));
});
