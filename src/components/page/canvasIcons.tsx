import { Icon } from '../ui/Icon'

/**
 * Çizim ve whiteboard simgeleri (096). Ayrı dosyada: ağaç menüleri
 * (`layout/treeMenus.tsx`) da kullanıyor ve PageTree onları içe aktarıyor.
 */
/** Shapes — a drawing (096, beta). */
export const DrawingIcon = ({ size = 16, className = '' }: { size?: number; className?: string }) => <Icon name="drawing" size={size} className={className} />

/** A board with a pen — a whiteboard (096, beta). */
export const WhiteboardIcon = ({ size = 16, className = '' }: { size?: number; className?: string }) => <Icon name="whiteboard" size={size} className={className} />
