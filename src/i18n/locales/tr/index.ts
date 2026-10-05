import { common } from './common'
import { auth } from './auth'
import { board } from './board'
import { ticket } from './ticket'
import { ticketExtra } from './ticketExtra'
import { inbox } from './inbox'
import { settings } from './settings'
import { team } from './team'
import { misc } from './misc'
import { page } from './page'
import { onenote } from './onenote'
import { canvas } from './canvas'

/** Namespaces are separate files so several areas of the app can be translated
 *  without editing the same file; they are merged into one flat key space. */
export const tr = {
  ...common,
  ...auth,
  ...board,
  ...ticket,
  ...ticketExtra,
  ...inbox,
  ...settings,
  ...team,
  ...misc,
  ...page,
  ...onenote,
  ...canvas,
}
