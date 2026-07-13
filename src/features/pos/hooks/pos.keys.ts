export const posKeys = {
  all: ['pos'] as const,
  menu: () => [...posKeys.all, 'menu'] as const,
  context: () => [...posKeys.all, 'context'] as const,
}
