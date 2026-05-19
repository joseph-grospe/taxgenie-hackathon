import { IconEye, IconEyeOff } from '@tabler/icons-react'
import type { ComponentProps } from 'react'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'

type PasswordInputProps = Omit<
  ComponentProps<typeof InputGroupInput>,
  'type'
> & {
  inputGroupClassName?: string
  isVisible: boolean
  onVisibilityChange: (isVisible: boolean) => void
  visibilityLabel: string
}

export function PasswordInput({
  disabled,
  inputGroupClassName,
  isVisible,
  onVisibilityChange,
  readOnly,
  visibilityLabel,
  ...props
}: PasswordInputProps) {
  const toggleLabel = `${isVisible ? 'Hide' : 'Show'} ${visibilityLabel}`

  return (
    <InputGroup className={inputGroupClassName}>
      <InputGroupInput
        {...props}
        disabled={disabled}
        readOnly={readOnly}
        type={isVisible ? 'text' : 'password'}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={toggleLabel}
          aria-pressed={isVisible}
          disabled={disabled || readOnly}
          onClick={() => onVisibilityChange(!isVisible)}
        >
          {isVisible ? (
            <IconEyeOff data-icon="inline-start" />
          ) : (
            <IconEye data-icon="inline-start" />
          )}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
