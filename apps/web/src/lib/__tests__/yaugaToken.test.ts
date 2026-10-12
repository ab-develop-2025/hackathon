import { describe, expect, it } from 'vitest'
import { conversionQuote } from '../yaugaToken'

describe('conversionQuote', () => {
  it('stays closed below 500 points', () => {
    const quote = conversionQuote(499, 1, 100, 500)
    expect(quote.eligible).toBe(false)
    expect(quote.canConvert).toBe(false)
    expect(quote.maxTokens).toBe(4)
  })

  it('converts whole tokens and leaves the remainder', () => {
    const quote = conversionQuote(550, 5, 100, 500)
    expect(quote).toMatchObject({ eligible: true, canConvert: true, cost: 500, remainder: 50, maxTokens: 5 })
  })

  it('rejects a token count the balance cannot cover', () => {
    const quote = conversionQuote(550, 6, 100, 500)
    expect(quote.canConvert).toBe(false)
    expect(quote.maxTokens).toBe(5)
  })
})
