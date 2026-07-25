export function cleanProductDetailPriceValue(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return text.replace(/^(?:(?:dop|rd)\$?\s*)+/i, '').replace(/\s+/g, ' ').trim()
}

export function formatProductDetailPrice(value: unknown): string {
  const cleaned = cleanProductDetailPriceValue(value)
  if (!cleaned) return ''
  const numeric = cleaned.replace(/,/g, '')
  if (!/^\d+(?:\.\d+)?$/.test(numeric)) return `RD$${cleaned}`
  const [integerPart, decimalPart] = numeric.split('.')
  const formattedInteger = Number(integerPart).toLocaleString('en-US')
  return `RD$${decimalPart ? `${formattedInteger}.${decimalPart}` : formattedInteger}`
}
