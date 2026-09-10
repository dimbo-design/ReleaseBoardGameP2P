import type { InputProps } from '@release/ui'
import { Input } from '@release/ui'
import { play } from '@release/ui/animations'
import type { FormHTMLAttributes } from 'react'
import { createContext, useContext, useState } from 'react'

type Errors = Record<string, string>

const FormCtx = createContext<Errors>({})

function useFormError(name: string): string {
  return useContext(FormCtx)[name] ?? ''
}

export function FormField({ name = '', error, ...rest }: InputProps) {
  const contextError = useFormError(name)
  return <Input name={name} error={error ?? (contextError || undefined)} {...rest} />
}

interface FormProps extends Omit<FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> {
  onSubmit: (data: Record<string, string>) => void
  requiredMessage?: string
}

export default function Form({ onSubmit, requiredMessage = 'Required', ...rest }: FormProps) {
  const [errors, setErrors] = useState<Errors>({})

  return (
    <FormCtx.Provider value={errors}>
      <form
        noValidate
        {...rest}
        onSubmit={(e) => {
          e.preventDefault()
          const newErrors: Errors = {}
          const invalid: HTMLInputElement[] = []
          for (const el of Array.from(e.currentTarget.elements)) {
            const input = el as HTMLInputElement
            if (input.name && input.required && !input.value.trim()) {
              newErrors[input.name] = requiredMessage
              invalid.push(input)
            }
          }
          if (invalid.length > 0) {
            setErrors(newErrors)
            // Shake every offending field on every attempt — fires even when the
            // error is unchanged (a repeat submit of the same empty field).
            // Fall back to the control itself for fields without a [data-field]
            // wrapper (e.g. a raw input), so they still get visible feedback.
            for (const input of invalid) play('shake', input.closest('[data-field]') ?? input)
            return
          }
          setErrors({})
          // Merged in by hand rather than passed to `new FormData(form,
          // submitter)`: that two-argument constructor is a Safari 16.4
          // addition, and `browserslist` here declares `safari >= 15`. On an
          // older Safari the extra argument is silently discarded rather than
          // throwing, so `data.intent` would come back `undefined` and a form
          // with two submit buttons (create/solo) could never tell which one
          // fired — this is not a stylistic choice to "simplify" away.
          const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
          const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
          if (submitter?.name) data[submitter.name] = submitter.value
          onSubmit(data)
        }}
        onChange={(e) => {
          const input = e.target as unknown as HTMLInputElement
          if (input.name && errors[input.name]) {
            setErrors((prev) => {
              const next = { ...prev }
              delete next[input.name]
              return next
            })
          }
          rest.onChange?.(e)
        }}
      />
    </FormCtx.Provider>
  )
}
