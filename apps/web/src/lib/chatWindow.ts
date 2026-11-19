let auxiliaryChatWindow: boolean | undefined;

export function isAuxiliaryChatWindow(): boolean {
  if (typeof window === "undefined") return false;
  if (auxiliaryChatWindow === undefined) {
    const marked = new URLSearchParams(window.location.search).has("threadWindow");
    try {
      if (marked) window.sessionStorage.setItem("t3code:thread-window", "1");
      auxiliaryChatWindow = marked || window.sessionStorage.getItem("t3code:thread-window") === "1";
    } catch {
      auxiliaryChatWindow = marked;
    }
  }
  return auxiliaryChatWindow;
}
