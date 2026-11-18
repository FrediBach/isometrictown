import { useState, type FormEvent } from 'react';
import { KeyRoundIcon, LockIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { unlockImage } from '../app/invite';

/** Asks for the invite key that opens image mode. */
export function InviteDialog({ open, onOpenChange, onUnlock }: { open: boolean; onOpenChange: (open: boolean) => void; onUnlock: () => void }) {
  const [key, setKey] = useState('');
  const [wrong, setWrong] = useState(false);

  function onSubmit(e: FormEvent): void {
    e.preventDefault();
    if (unlockImage(key)) {
      setKey('');
      setWrong(false);
      onUnlock();
    } else setWrong(true);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setKey('');
          setWrong(false);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-[min(400px,calc(100vw-32px))] gap-0 overflow-hidden rounded-lg border border-input bg-background p-0 ring-0 sm:max-w-[400px]">
        <DialogHeader className="flex-row items-center gap-3 border-b border-input bg-card px-6 py-4 text-left">
          <LockIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          <div>
            <DialogTitle className="text-lg leading-tight font-semibold tracking-[-0.02em]">Image mode</DialogTitle>
            <DialogDescription className="micro mt-1 text-[10.5px] text-muted-foreground">By invitation</DialogDescription>
          </div>
        </DialogHeader>
        <form className="flex flex-col gap-3 px-6 pt-5 pb-5 text-sm leading-relaxed text-pretty" onSubmit={onSubmit}>
          <p className="m-0 text-muted-foreground">Image mode lays out a town that looks like a picture. It’s still being built, so for now it’s open to invited friends only. Enter your invite key to try it.</p>
          <div
            className={cn(
              'flex h-10 items-stretch overflow-hidden rounded-md border bg-card transition-shadow focus-within:ring-3',
              wrong ? 'border-destructive focus-within:ring-destructive/30' : 'border-input focus-within:border-foreground/40 focus-within:ring-ring/30'
            )}
          >
            <KeyRoundIcon aria-hidden className="ml-3 size-4 shrink-0 self-center text-muted-foreground" />
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={key}
              onChange={(e) => {
                setKey(e.currentTarget.value);
                setWrong(false);
              }}
              placeholder="Invite key"
              aria-label="Invite key"
              aria-invalid={wrong}
              className="min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <p className={cn('m-0 -mt-1 text-xs', wrong ? 'text-destructive' : 'invisible')} aria-live="polite">
            {wrong ? 'That key doesn’t open it.' : ' '}
          </p>
          <div className="flex justify-end">
            <Button type="submit" disabled={!key.trim()}>
              Unlock
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
