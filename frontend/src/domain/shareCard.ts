/** 分享图最短画布。短文案保持原来的 1080×1920。 */
export const SHARE_CARD_MIN_HEIGHT = 1920

/** 短文案时页脚的基线，和改版前画在 1780 的位置一致。 */
export const SHARE_CARD_FOOTER_BASELINE = 1780

/**
 * 正文底边超过原页脚时加高画布，把页脚画到正文下面。
 * 短文案不改高度，避免一张短卡片被拉成另一种版式。
 */
export function shareCardFrame(contentBottom: number): { height: number; footerY: number } {
  const footerY = Math.max(SHARE_CARD_FOOTER_BASELINE, contentBottom + 72)
  const height = Math.max(SHARE_CARD_MIN_HEIGHT, footerY + 80)
  return { height, footerY }
}
