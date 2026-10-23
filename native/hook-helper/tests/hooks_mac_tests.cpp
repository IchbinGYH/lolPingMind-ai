// Exercise the production macOS callback without installing a tap or posting input to other apps.
#include <ApplicationServices/ApplicationServices.h>
#include <iostream>
#include <vector>

namespace {
CGEventFlags flags = 0;
std::vector<int64_t> replayedCounts;
CGEventFlags testFlags(CGEventSourceStateID) { return flags; }
void testPost(CGEventTapLocation, CGEventRef event) {
  replayedCounts.push_back(CGEventGetIntegerValueField(event, kCGMouseEventClickState));
}
}

#define CGEventPost testPost
#define CGEventSourceFlagsState testFlags
#include "../src/hooks_mac.cpp"
#undef CGEventSourceFlagsState
#undef CGEventPost

int main() {
  int passed = 0, failed = 0;
  lp::Output out([](const std::string&) { return true; });
  lp::g_out = &out;
  const auto check = [&](bool condition, const char* message) {
    if (condition) ++passed;
    else { ++failed; std::cerr << message << '\n'; }
  };
  const auto mouse = [](CGEventType type, CGMouseButton button, int64_t count) {
    auto event = CGEventCreateMouseEvent(nullptr, type, CGPointMake(100, 100), button);
    CGEventSetFlags(event, flags);
    CGEventSetIntegerValueField(event, kCGMouseEventButtonNumber, button);
    CGEventSetIntegerValueField(event, kCGMouseEventClickState, count);
    const bool swallowed = lp::tapCallback(nullptr, type, event, nullptr) == nullptr;
    CFRelease(event);
    return swallowed;
  };
  for (const int64_t count : {1, 2, 3}) {
    for (const bool sideButton : {false, true}) {
      lp::Decision decision;
      decision.setMaskMenuKeys(false);
      auto cfg = decision.config();
      cfg.trigger = sideButton ? lp::Trigger::Mouse4 : lp::Trigger::Alt;
      decision.setConfig(cfg);
      lp::g_decision = &decision;
      lp::g_flags = 0;
      flags = sideButton ? 0 : kCGEventFlagMaskAlternate;
      replayedCounts.clear();
      const auto button = static_cast<CGMouseButton>(sideButton ? 3 : 0);
      check(mouse(sideButton ? kCGEventOtherMouseDown : kCGEventLeftMouseDown, button, count), "gesture press should be swallowed");
      // An unrelated button must not overwrite the gesture's click count.
      mouse(kCGEventRightMouseUp, kCGMouseButtonRight, 1);
      check(mouse(sideButton ? kCGEventOtherMouseUp : kCGEventLeftMouseUp, button, count), "gesture release should be swallowed");
      check(replayedCounts == std::vector<int64_t>({count, count}), "replayed down/up must preserve the original click count");
    }
  }
  // Releasing Option before the mouse also replays the saved press, before a mouse-up arrives.
  lp::Decision decision;
  decision.setMaskMenuKeys(false);
  lp::g_decision = &decision;
  lp::g_flags = 0;
  flags = kCGEventFlagMaskAlternate;
  replayedCounts.clear();
  mouse(kCGEventLeftMouseDown, kCGMouseButtonLeft, 2);
  flags = 0;
  auto release = CGEventCreateKeyboardEvent(nullptr, 58, false);
  CGEventSetType(release, kCGEventFlagsChanged);
  CGEventSetFlags(release, 0);
  lp::tapCallback(nullptr, kCGEventFlagsChanged, release, nullptr);
  CFRelease(release);
  check(replayedCounts == std::vector<int64_t>({2}), "trigger release must preserve the saved double-click count");
  check(!mouse(kCGEventLeftMouseUp, kCGMouseButtonLeft, 2), "real mouse-up after trigger release should pass through");
  lp::g_decision = nullptr;
  lp::g_out = nullptr;
  std::cout << passed << " passed, " << failed << " failed (macOS callback)\n";
  return failed ? 1 : 0;
}
