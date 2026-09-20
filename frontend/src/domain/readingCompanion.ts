import examples from '@/content/readingCompanion.json'

/** Reading aid only. Match both the saved version and wording; never infer from an item ID alone. */
export function questionExample(packageId: string | undefined, item: {
  id: string; scenario?: string | null; textLeft?: string | null; textRight?: string | null; statement?: string | null
} | null): string | null {
  if (!packageId || !item) return null
  const copy = examples.find(copy => copy.packageId === packageId && copy.id === item.id)
  if (!copy) return null
  if (copy.statement !== undefined) return copy.statement === item.statement ? copy.example : null
  return copy.scenario === item.scenario && copy.textLeft === item.textLeft && copy.textRight === item.textRight ? copy.example : null
}
