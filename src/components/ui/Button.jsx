import styles from './Button.module.css'

/**
 * Normalized button component.
 *
 * variant  — 'primary' | 'secondary' | 'danger' | 'ghost'  (default: 'secondary')
 * size     — 'sm' | 'md' | 'compact'                        (default: 'md')
 *
 * 'compact' matches the height of a text input (padding: 7px 12px, md font-size).
 * All other HTML button attrs (onClick, disabled, title, type, …) pass through.
 */
export default function Button({ variant = 'secondary', size = 'md', className = '', ...props }) {
  return (
    <button
      className={[
        styles.btn,
        styles[variant],
        styles[size],
        className,
      ].filter(Boolean).join(' ')}
      {...props}
    />
  )
}
