#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>

static int result(const char *status) { puts(status); return 0; }
// Only the desktop main process invokes this helper. It supplies the chord
// read from Typeless's settings; neither the server nor renderer supplies keys.
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (!AXIsProcessTrusted() || !CGPreflightPostEventAccess()) return result("permission");
    NSArray<NSRunningApplication *> *apps = [NSRunningApplication runningApplicationsWithBundleIdentifier:@"now.typeless.desktop"];
    if (apps.count == 0) return result("not-running");
    if (argc == 2 && strcmp(argv[1], "--check") == 0) return result("ready");
    if (argc < 3 || argc > 10) return result("unavailable");
    pid_t parent = (pid_t)atoi(argv[1]);
    if (parent != getppid() || NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier != parent) return result("unfocused");
    CGEventFlags modifiers = kCGEventFlagMaskShift | kCGEventFlagMaskControl | kCGEventFlagMaskAlternate | kCGEventFlagMaskCommand | kCGEventFlagMaskSecondaryFn;
    if (CGEventSourceFlagsState(kCGEventSourceStateCombinedSessionState) & modifiers) return result("keys-held");
    CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
    if (!source) return result("unavailable");
    // Prepare every press and release before posting anything. Modifier-only
    // bindings, including Fn, use flagsChanged rather than ordinary keyDown.
    CGEventRef events[16] = {0}; CGEventFlags flags = 0;
    int count = argc - 2; BOOL valid = YES;
    unsigned codes[8] = {0}; unsigned long long masks[8] = {0};
    for (int i = 0; i < count; i++) {
      char extra;
      if (sscanf(argv[i + 2], "%u:%llu%c", &codes[i], &masks[i], &extra) != 2 || codes[i] > 127 || (masks[i] & ~modifiers)) { valid = NO; break; }
      flags |= masks[i];
      events[i] = CGEventCreateKeyboardEvent(source, (CGKeyCode)codes[i], true);
      if (!events[i]) { valid = NO; break; }
      if (masks[i]) CGEventSetType(events[i], kCGEventFlagsChanged);
      CGEventSetFlags(events[i], flags);
    }
    for (int i = count - 1; valid && i >= 0; i--) {
      flags &= ~masks[i]; int index = count * 2 - 1 - i;
      events[index] = CGEventCreateKeyboardEvent(source, (CGKeyCode)codes[i], false);
      if (!events[index]) { valid = NO; break; }
      if (masks[i]) CGEventSetType(events[index], kCGEventFlagsChanged);
      CGEventSetFlags(events[index], flags);
    }
    if (valid) { puts("prepared"); fflush(stdout); if (getchar() != 'y') valid = NO; }
    if (valid && NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier == parent && !(CGEventSourceFlagsState(kCGEventSourceStateCombinedSessionState) & modifiers)) {
      for (int i = 0; i < count * 2; i++) {
        CGEventPost(kCGHIDEventTap, events[i]);
        usleep(20000);
      }
    } else valid = NO;
    for (int i = 0; i < count * 2; i++) if (events[i]) CFRelease(events[i]);
    CFRelease(source);
    // Delivery is not an acknowledgement of Typeless's recording state.
    return result(valid ? "sent" : "unavailable");
  }
}
