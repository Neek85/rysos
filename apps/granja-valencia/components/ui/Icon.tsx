// Íconos SVG replicados literal del mockup real (claude.ai/artifact/
// 7vebvnVwLNR15TT9DL2DyX, objeto ICONS + el logout-btn del statusbar) --
// mismo viewBox/path data, no reinventados.
import Svg, { Circle, Path, Rect } from 'react-native-svg'

export type IconName =
  | 'parto'
  | 'destete'
  | 'pesaje'
  | 'mortalidad'
  | 'venta'
  | 'sanidad'
  | 'insumos'
  | 'empadre'
  | 'lotes'
  | 'pozas'
  | 'compras'
  | 'traslado'
  | 'logout'
  | 'back'

type Props = {
  name: IconName
  size?: number
  color?: string
}

export function Icon({ name, size = 18, color = 'currentColor' }: Props) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" color={color}>
      {name === 'parto' && (
        <>
          <Path {...common} d="M3 16c1.5-4 5-6.5 9-6.5s7.5 2.5 9 6.5" />
          <Circle cx="9" cy="13.5" r="1.6" fill="currentColor" stroke="none" />
          <Circle cx="12.3" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <Circle cx="15.6" cy="13.5" r="1.6" fill="currentColor" stroke="none" />
        </>
      )}
      {name === 'destete' && (
        <>
          <Rect {...common} x="2" y="9" width="7" height="7" rx="1.3" />
          <Rect {...common} x="15" y="9" width="7" height="7" rx="1.3" />
          <Path {...common} d="M9.5 12.5h4.2" />
          <Path {...common} d="M12 10.5l2.2 2-2.2 2" />
        </>
      )}
      {name === 'pesaje' && (
        <>
          <Path {...common} d="M12 3v3" />
          <Path {...common} d="M4 6h16" />
          <Path {...common} d="M6 6l-3 7a3 3 0 0 0 6 0z" />
          <Path {...common} d="M18 6l-3 7a3 3 0 0 0 6 0z" />
        </>
      )}
      {name === 'mortalidad' && (
        <>
          <Path {...common} d="M12 2L2 21h20L12 2z" />
          <Path {...common} d="M12 9v5" />
        </>
      )}
      {name === 'venta' && (
        <>
          <Path {...common} d="M12 2v20" />
          <Path {...common} d="M17 6H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H6" />
        </>
      )}
      {name === 'sanidad' && (
        <>
          <Path {...common} d="M12 3l7 3v6c0 4.2-3 7-7 9-4-2-7-4.8-7-9V6z" />
          <Path {...common} d="M9.5 12l1.8 1.8L14.5 10" />
        </>
      )}
      {name === 'insumos' && (
        <>
          <Path {...common} d="M4 8l8-4 8 4-8 4-8-4z" />
          <Path {...common} d="M4 8v8l8 4 8-4V8" />
          <Path {...common} d="M12 12v8" />
        </>
      )}
      {name === 'empadre' && (
        <>
          <Circle {...common} cx="9" cy="12" r="6" />
          <Circle {...common} cx="15" cy="12" r="6" />
        </>
      )}
      {name === 'lotes' && (
        <>
          <Rect {...common} x="3" y="4" width="8" height="8" rx="1.3" />
          <Rect {...common} x="13" y="4" width="8" height="8" rx="1.3" />
          <Rect {...common} x="3" y="14" width="8" height="6" rx="1.3" />
          <Rect {...common} x="13" y="14" width="8" height="6" rx="1.3" />
        </>
      )}
      {name === 'pozas' && (
        <>
          <Rect {...common} x="3" y="10" width="18" height="10" rx="1.3" />
          <Path {...common} d="M3 10l9-6 9 6" />
          <Path {...common} d="M9 20v-5h6v5" />
        </>
      )}
      {name === 'compras' && (
        <>
          <Path {...common} d="M6 2l1.5 2h9L18 2" />
          <Path {...common} d="M4 6h16l-1.4 12.2a2 2 0 0 1-2 1.8H7.4a2 2 0 0 1-2-1.8L4 6z" />
          <Path {...common} d="M9 10v4" />
          <Path {...common} d="M15 10v4" />
        </>
      )}
      {name === 'traslado' && (
        <>
          <Path {...common} d="M4 7h13" />
          <Path {...common} d="M13 3l4 4-4 4" />
          <Path {...common} d="M20 17H7" />
          <Path {...common} d="M11 13l-4 4 4 4" />
        </>
      )}
      {name === 'logout' && (
        <>
          <Path {...common} d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <Path {...common} d="M16 17l5-5-5-5" />
          <Path {...common} d="M21 12H9" />
        </>
      )}
      {name === 'back' && (
        <>
          <Path {...common} d="M19 12H5" />
          <Path {...common} d="M11 18l-6-6 6-6" />
        </>
      )}
    </Svg>
  )
}
