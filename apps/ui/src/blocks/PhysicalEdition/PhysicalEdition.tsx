import duckArt from '@/assets/cards/parallax/illustration/rubber-ducky.png'
import styles from './PhysicalEdition.module.css'

// Текст блока приходит пропсом (компонент i18n-agnostic). Дефолт — русский.
export interface PhysicalEditionCopy {
  title: string
  // первое предложение — посыл «поддержать проект»
  lead: string
  // второе предложение перед ссылкой («Заказать… —»)
  order: string
  // подпись самой ссылки (ведёт на заказ/предзаказ)
  linkLabel: string
  // alt для будущей картинки коробки (сейчас плейсхолдер-квадрат)
  imageAlt: string
}

interface PhysicalEditionProps {
  // ссылка на заказ/предзаказ (напр. Instagram команды)
  href: string
  copy: PhysicalEditionCopy
  // позиционирование/ширину задаёт место использования (мерджится в корень)
  className?: string
}

// Блок «печатная версия»: матовая плашка — слева заголовок + подпись со ссылкой
// на заказ, справа квадрат под арт коробки (выпирает за верхнюю грань).
export default function PhysicalEdition({ href, copy, className = '' }: PhysicalEditionProps) {
  return (
    <div className={`${styles.box}${className ? ` ${className}` : ''}`}>
      <div className={styles.text}>
        <h3 className={styles.title}>{copy.title}</h3>
        <p className={styles.note}>
          {copy.lead} {copy.order}{' '}
          <a className={styles.link} href={href} target="_blank" rel="noopener noreferrer">
            {copy.linkLabel}
          </a>
        </p>
      </div>
      <img className={styles.image} src={duckArt} alt={copy.imageAlt} />
    </div>
  )
}
