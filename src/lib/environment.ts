
export class Environment {
  // Detects if device is on iOS
// Detects if device is in standalone mode
  static isIos(): boolean {
    const userAgent = window.navigator.userAgent.toLowerCase();
    return /iphone|ipad|ipod/.test(userAgent);
  }

  // スマホ・タブレットのブラウザか(MetaMask/Bitget のブラウザ拡張が使えない環境)。
  // iPadOS 13+ は UA が Macintosh になるため、タッチ対応の Mac も含めて判定する。
  static isMobile(): boolean {
    const ua = window.navigator.userAgent.toLowerCase();
    if (/android|iphone|ipad|ipod|mobile/.test(ua)) {
      return true;
    }
    return /macintosh/.test(ua) && window.navigator.maxTouchPoints > 1;
  }

  static isInStandaloneMode(): boolean {
    return ('standalone' in window.navigator) && ((window.navigator as any).standalone);
  }
}
