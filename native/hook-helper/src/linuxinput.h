#pragma once
#include <cstdint>
namespace lp::x11 {
// X keysyms -> the platform-neutral VK values used by the shared protocol.
uint32_t keyNameToVk(const char* name);
uint32_t keysymToVk(unsigned long sym);
}
