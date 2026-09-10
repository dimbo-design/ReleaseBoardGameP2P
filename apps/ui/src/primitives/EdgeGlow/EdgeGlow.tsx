import type { CSSProperties } from 'react'
import styles from './EdgeGlow.module.css'

interface EdgeGlowProps {
  // показать/скрыть — плавно появляется и затухает от краёв
  visible?: boolean
  // сила свечения (стол игрока — strong; место соперника — weak)
  intensity?: 'strong' | 'weak'
  // цвет свечения (по умолчанию — токен тревоги стола)
  color?: string
  className?: string
  'data-testid'?: string
}

// Краевое свечение области: мягко светит от краёв контейнера внутрь.
// Глупый презентационный оверлей — границы и слой (z) задаёт потребитель
// (контейнером и местом монтирования). Про игровые события не знает.
export default function EdgeGlow({
  visible = true,
  intensity = 'strong',
  color = 'var(--alarm-glow)',
  className = '',
  'data-testid': dataTestId,
}: EdgeGlowProps) {
  return (
    <div
      aria-hidden="true"
      className={`${styles.glow} ${styles[intensity]} ${visible ? styles.on : ''} ${className}`}
      style={{ '--glow': color } as CSSProperties}
      data-testid={dataTestId}
    />
  )
}
