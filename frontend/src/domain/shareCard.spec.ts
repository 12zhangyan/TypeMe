import { describe, expect, it } from 'vitest'
import { SHARE_CARD_FOOTER_BASELINE, SHARE_CARD_MIN_HEIGHT, shareCardFrame } from './shareCard'

describe('分享图画布', () => {
  it('短文案保持原来的高度和页脚位置', () => {
    expect(shareCardFrame(900)).toEqual({ height: SHARE_CARD_MIN_HEIGHT, footerY: SHARE_CARD_FOOTER_BASELINE })
  })

  it('正文超过原页脚时加高，页脚画在正文下面', () => {
    const frame = shareCardFrame(2000)
    expect(frame.footerY).toBeGreaterThan(2000)
    expect(frame.height).toBeGreaterThan(frame.footerY)
    expect(frame.height).toBeGreaterThan(SHARE_CARD_MIN_HEIGHT)
  })
})
