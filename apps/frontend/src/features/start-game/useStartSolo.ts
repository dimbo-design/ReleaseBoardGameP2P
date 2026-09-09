import type { Setup } from '@release/ui'
import { useSession } from '~/app/providers/SessionProvider'

// The bot names are built HERE rather than in `network/`, which may not import
// i18next: the caller passes a formatter and this turns a count into a list.
export function useStartSolo() {
  const session = useSession()
  return (name: string, bots: number, setup: Setup, botName: (n: number) => string) =>
    session.startSolo(
      name,
      Array.from({ length: bots }, (_, i) => botName(i + 1)),
      setup,
    )
}
