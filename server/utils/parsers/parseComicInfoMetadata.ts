/**
 * ComicInfo.xml parsed by xml2js (only the fields used)
 */
interface ComicInfoJson {
  ComicInfo?: {
    Series?: string[]
    Number?: string[]
    Summary?: string[]
  }
}

/**
 * TODO: Add more fields
 * @see https://anansi-project.github.io/docs/comicinfo/intro
 */
const parse = (comicInfoJson: ComicInfoJson | null | undefined) => {
  if (!comicInfoJson?.ComicInfo) return null

  const ComicSeries = comicInfoJson.ComicInfo.Series?.[0]?.trim() || null
  const ComicNumber = comicInfoJson.ComicInfo.Number?.[0]?.trim() || null
  const ComicSummary = comicInfoJson.ComicInfo.Summary?.[0]?.trim() || null

  let title: string | null = null
  const series: { name: string; sequence: string | null }[] = []
  if (ComicSeries) {
    series.push({
      name: ComicSeries,
      sequence: ComicNumber
    })

    title = ComicSeries
    if (ComicNumber) {
      title += ` ${ComicNumber}`
    }
  }

  return {
    title,
    series,
    description: ComicSummary
  }
}

export = { parse }
