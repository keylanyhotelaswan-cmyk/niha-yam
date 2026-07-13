type PlaceholderViewProps = {
  title: string
  body: string
}

export function PlaceholderView({ title, body }: PlaceholderViewProps) {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-muted-foreground text-sm">{body}</p>
    </div>
  )
}
