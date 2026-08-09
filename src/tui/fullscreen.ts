const ESC = "\x1B";
const ENTER_ALT_SCREEN = `${ESC}[?1049h${ESC}[?25l${ESC}[H${ESC}[2J`;
const EXIT_ALT_SCREEN = `${ESC}[?25h${ESC}[?1049l`;

/** Runs the chat in the terminal alternate screen so the viewport behaves like a full-screen TUI. */
export async function runFullscreen<T>(action: () => Promise<T>): Promise<T> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return await action();
  }

  process.stdout.write(ENTER_ALT_SCREEN);
  try {
    return await action();
  } finally {
    process.stdout.write(EXIT_ALT_SCREEN);
  }
}
