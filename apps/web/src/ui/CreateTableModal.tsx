import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { sanitizeInput } from '../lib/security';
import { useFocusTrap } from '../hooks/useFocusTrap';

export interface CreateTableConfig {
  name: string;
  tickSize: number;
  rounds: number;
  feePercent: number;
  voiceEnabled: boolean;
}

interface CreateTableModalProps {
  onCreate: (config: CreateTableConfig) => Promise<void> | void;
  defaultVoiceEnabled?: boolean;
  disabled?: boolean;
  disabledMessage?: string;
}

const initialFormState = (defaultVoiceEnabled: boolean) => ({
  name: '',
  tickSize: 1,
  rounds: 3,
  feePercent: 1,
  voiceEnabled: defaultVoiceEnabled,
});

export default function CreateTableModal({
  onCreate,
  defaultVoiceEnabled = true,
  disabled = false,
  disabledMessage,
}: CreateTableModalProps) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formState, setFormState] = useState(initialFormState(defaultVoiceEnabled));
  const [formMessage, setFormMessage] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!isSubmitting) {
          closeModal();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isSubmitting]);

  useEffect(() => {
    if (open) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      setTimeout(() => firstFieldRef.current?.focus(), 0);
    } else {
      previousActiveElement.current?.focus();
    }
  }, [open]);

  const closeModal = () => {
    setOpen(false);
    setFormMessage(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const cleaned: CreateTableConfig = {
      name: sanitizeInput(formState.name.trim()) || 'Untitled table',
      tickSize: Math.max(1, Number(formState.tickSize) || 1),
      rounds: Math.max(1, Math.min(12, Number(formState.rounds) || 3)),
      feePercent: Math.max(0, Math.min(15, Number(formState.feePercent) || 1)),
      voiceEnabled: Boolean(formState.voiceEnabled),
    };

    try {
      setIsSubmitting(true);
      await onCreate(cleaned);
      setFormMessage('Table created – shuffling deck!');
      setFormState(initialFormState(defaultVoiceEnabled));
      setTimeout(() => {
        closeModal();
        setIsSubmitting(false);
      }, 500);
    } catch (error) {
      console.error('Unable to create table', error);
      setFormMessage('We could not create the table. Please try again.');
      setIsSubmitting(false);
    }
  };

  const handleFieldChange = (field: keyof CreateTableConfig) => (value: string | boolean) => {
    setFormState((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleOpen = () => {
    if (disabled) {
      setFormMessage(disabledMessage ?? 'Sign in to launch a table.');
      return;
    }
    setOpen(true);
  };

  return (
    <div className="create-table">
      <button
        type="button"
        className="button button--primary"
        onClick={handleOpen}
        disabled={disabled}
        aria-disabled={disabled}
        title={disabled ? disabledMessage : undefined}
      >
        ➕ Create Table
      </button>

      {disabled && (
        <p className="inline-notice inline-notice--info" role="note" style={{ marginTop: 8 }}>
          {disabledMessage ?? 'Sign in to launch a table.'}
        </p>
      )}

      {open && (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => !isSubmitting && closeModal()}
        >
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-table-title"
            onClick={(event) => event.stopPropagation()}
            ref={dialogRef}
            tabIndex={-1}
          >
            <header className="section-heading" style={{ marginBottom: 16 }}>
              <div>
                <h2 id="create-table-title" style={{ margin: 0 }}>Create a new table</h2>
                <p className="page__subtitle" style={{ fontSize: '0.85rem' }}>
                  Configure tick size, rounds, and house fee before launching your table.
                </p>
              </div>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => !isSubmitting && closeModal()}
                disabled={isSubmitting}
              >
                ✕
              </button>
            </header>

            <form className="form-grid" onSubmit={handleSubmit}>
              <label htmlFor="table-name">
                Table name
                <input
                  id="table-name"
                  ref={firstFieldRef}
                  type="text"
                  placeholder="Bull vs Bear showdown"
                  value={formState.name}
                  maxLength={40}
                  onChange={(event) => handleFieldChange('name')(event.target.value)}
                  required
                />
              </label>

              <div className="grid grid--two">
                <label htmlFor="tick-size">
                  Tick size
                  <input
                    id="tick-size"
                    type="number"
                    min={1}
                    max={25}
                    value={formState.tickSize}
                    onChange={(event) => handleFieldChange('tickSize')(event.target.value)}
                  />
                </label>

                <label htmlFor="round-count">
                  Rounds
                  <input
                    id="round-count"
                    type="number"
                    min={1}
                    max={12}
                    value={formState.rounds}
                    onChange={(event) => handleFieldChange('rounds')(event.target.value)}
                  />
                </label>
              </div>

              <label htmlFor="fee-percent">
                House fee (%)
                <input
                  id="fee-percent"
                  type="number"
                  min={0}
                  max={15}
                  step={0.5}
                  value={formState.feePercent}
                  onChange={(event) => handleFieldChange('feePercent')(event.target.value)}
                />
              </label>

              <label htmlFor="voice-enabled" style={{ alignItems: 'center', flexDirection: 'row' }}>
                <input
                  id="voice-enabled"
                  type="checkbox"
                  checked={formState.voiceEnabled}
                  onChange={(event) => handleFieldChange('voiceEnabled')(event.target.checked)}
                />
                <span>Enable voice commentary for this table</span>
              </label>

              {formMessage && (
                <div
                  className={`inline-notice ${formMessage.includes('created') ? 'inline-notice--success' : 'inline-notice--error'}`}
                  role="status"
                >
                  {formMessage}
                </div>
              )}

              <div className="page__actions" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => closeModal()}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button--primary"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Launching…' : 'Launch table'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
