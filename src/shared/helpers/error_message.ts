export function error_message(error: unknown): string {

  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return "Unknown error.";
  }

}
