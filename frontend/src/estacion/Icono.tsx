import sprite from './iconos.svg?raw';

/** Inserta el sprite SVG una sola vez (ids con prefijo est-). */
export function SpriteIconos() {
  return <div style={{ display: 'none' }} dangerouslySetInnerHTML={{ __html: sprite }} />;
}

export function Icono({ id, className = 'ico' }: { id: string; className?: string }) {
  return <svg className={className} aria-hidden="true"><use href={`#est-${id}`} /></svg>;
}
