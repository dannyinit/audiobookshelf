// Type declarations for the vendored date-and-time library (only the API used by the server)
declare const date: {
  format(dateObj: Date, formatString: string, utc?: boolean): string
  parse(dateString: string, formatString: string, utc?: boolean): Date
  isValid(dateString: string, formatString?: string): boolean
  addDays(dateObj: Date, days: number): Date
  addMonths(dateObj: Date, months: number): Date
  addYears(dateObj: Date, years: number): Date
}

export = date
