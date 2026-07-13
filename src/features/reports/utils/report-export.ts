/** Cairo calendar date YYYY-MM-DD */
export function cairoToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function downloadCsv(filename: string, rows: string[][]) {
  const esc = (c: string) => `"${c.replaceAll('"', '""')}"`
  const body = rows.map((r) => r.map((c) => esc(String(c ?? ''))).join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function printReportNode(title: string) {
  document.title = title
  window.print()
}
