#include "linuxinput.h"
#include <X11/keysym.h>
#include <cstring>
#include <initializer_list>
namespace lp::x11 {
// Chromium KeyboardEvent.code describes physical positions even on non-US layouts.
// Prefer XKB physical names for printable keys; symbols remain the fallback for special keys.
uint32_t keyNameToVk(const char* name) {
  const char* rows[] = {"AE", "AD", "AC", "AB"};
  const char* keys[] = {"1234567890", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"};
  for (int row = 0; row < 4; ++row) {
    if (name[0] != rows[row][0] || name[1] != rows[row][1]) continue;
    const int col = (name[2] - '0') * 10 + name[3] - '0';
    if (col > 0 && col <= static_cast<int>(std::strlen(keys[row]))) return keys[row][col-1];
  }
  struct Entry { const char* name; uint32_t vk; };
  for (const auto& e : {Entry{"TLDE",0xC0}, {"AE11",0xBD}, {"AE12",0xBB}, {"AD11",0xDB},
       {"AD12",0xDD}, {"BKSL",0xDC}, {"AC10",0xBA}, {"AC11",0xDE}, {"AB08",0xBC},
       {"AB09",0xBE}, {"AB10",0xBF}})
    if (std::strncmp(name,e.name,4)==0) return e.vk;
  return 0;
}
uint32_t keysymToVk(unsigned long s) {
  if (s >= XK_a && s <= XK_z) return 0x41 + s - XK_a;
  if (s >= XK_A && s <= XK_Z) return 0x41 + s - XK_A;
  if (s >= XK_0 && s <= XK_9) return 0x30 + s - XK_0;
  if (s >= XK_F1 && s <= XK_F24) return 0x70 + s - XK_F1;
  if (s >= XK_KP_0 && s <= XK_KP_9) return 0x60 + s - XK_KP_0;
  switch (s) {
    case XK_Shift_L: return 0xA0; case XK_Shift_R: return 0xA1;
    case XK_Control_L: return 0xA2; case XK_Control_R: return 0xA3;
    case XK_Alt_L: return 0xA4; case XK_Alt_R: return 0xA5;
    case XK_Super_L: return 0x5B; case XK_Super_R: return 0x5C;
    case XK_Escape: return 0x1B; case XK_Tab: case XK_ISO_Left_Tab: return 0x09;
    case XK_Return: case XK_KP_Enter: return 0x0D; case XK_space: return 0x20;
    case XK_BackSpace: return 0x08; case XK_Delete: case XK_KP_Delete: return 0x2E;
    case XK_Insert: case XK_KP_Insert: return 0x2D;
    case XK_Home: case XK_KP_Home: return 0x24; case XK_End: case XK_KP_End: return 0x23;
    case XK_Page_Up: case XK_KP_Page_Up: return 0x21; case XK_Page_Down: case XK_KP_Page_Down: return 0x22;
    case XK_Left: case XK_KP_Left: return 0x25; case XK_Up: case XK_KP_Up: return 0x26;
    case XK_Right: case XK_KP_Right: return 0x27; case XK_Down: case XK_KP_Down: return 0x28;
    case XK_Caps_Lock: return 0x14; case XK_Print: return 0x2C; case XK_Scroll_Lock: return 0x91;
    case XK_Pause: return 0x13; case XK_Num_Lock: return 0x90; case XK_Menu: return 0x5D;
    case XK_KP_Multiply: return 0x6A; case XK_KP_Add: return 0x6B; case XK_KP_Subtract: return 0x6D;
    case XK_KP_Decimal: return 0x6E; case XK_KP_Divide: return 0x6F;
    case XK_semicolon: return 0xBA; case XK_equal: return 0xBB; case XK_comma: return 0xBC;
    case XK_minus: return 0xBD; case XK_period: return 0xBE; case XK_slash: return 0xBF;
    case XK_grave: return 0xC0; case XK_bracketleft: return 0xDB; case XK_backslash: return 0xDC;
    case XK_bracketright: return 0xDD; case XK_apostrophe: return 0xDE;
    default: return 0;
  }
}
}
