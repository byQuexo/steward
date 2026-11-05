import { KeyRound, Pencil } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { UserAvatar } from '@/components/avatars';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Alert, Skeleton } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useI18n } from '@/context/i18n';
import { useToast } from '@/context/toast';
import { api } from '@/lib/api';
import type { AdminUsers, DirUser } from '@/lib/types';
import { errorMessage } from '@/lib/utils';

function RolesDialog({ user, roles, onClose, onSaved }: { user: DirUser; roles: string[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [picked, setPicked] = useState<string[]>(user.roles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (r: string, on: boolean) => setPicked((p) => (on ? [...p, r] : p.filter((x) => x !== r)));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.setRoles(user.id, picked);
      toast(t('users.saved', { count: res.sessions_ended }), { variant: 'success' });
      onSaved();
      onClose();
    } catch (e) {
      setError(t('users.saveFailed', { error: errorMessage(e) }));
    } finally {
      setBusy(false);
    }
  };

  const changed = picked.slice().sort().join(',') !== user.roles.slice().sort().join(',');

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('users.editFor', { name: user.name })}</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-[12.5px] font-medium">{t('eff.roles')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {roles.map((r) => (
              <div key={r} className="flex items-center gap-2 rounded-md border p-2.5">
                <Checkbox id={`role-${r}`} checked={picked.includes(r)} onCheckedChange={(v) => toggle(r, v === true)} />
                <Label htmlFor={`role-${r}`} className="font-mono text-xs">
                  {r}
                </Label>
              </div>
            ))}
          </div>
        </fieldset>
        <Alert variant="warning">
          <span className="inline-flex items-start gap-1.5">
            <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {t('users.revokeWarning', { name: user.name })}
          </span>
        </Alert>
        {error && <Alert variant="error">{error}</Alert>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('users.cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={busy || !changed}>
            {t('users.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UsersPage() {
  const { t } = useI18n();
  const [data, setData] = useState<AdminUsers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<DirUser | null>(null);

  const load = useCallback(() => {
    api.adminUsers().then(setData, (e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  return (
    <section aria-labelledby="users-title">
      <h2 id="users-title" className="text-[15px] font-semibold tracking-[-0.01em]">
        {t('users.title')}
      </h2>
      <p className="mb-3 mt-0.5 max-w-2xl text-[12.5px] text-muted-foreground">{t('users.subtitle')}</p>
      {error && <Alert variant="error">{t('common.error', { error })}</Alert>}
      {!data ? (
        <Skeleton className="h-64" />
      ) : (
        <Card>
          <CardContent className="p-2">
            <Table label={t('users.title')} data-testid="roles-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('eff.name')}</TableHead>
                  <TableHead>{t('users.email')}</TableHead>
                  <TableHead>{t('eff.roles')}</TableHead>
                  <TableHead>{t('eff.scopes')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('users.edit')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.users.map(({ user, effective_scopes, title }) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <UserAvatar name={user.name} size={26} />
                        <div>
                          <p className="font-medium">{user.name}</p>
                          <p className="text-xs text-muted-foreground">{title ?? user.id}</p>
                        </div>
                        {!user.enabled && <Badge variant="muted">{t('users.disabled')}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{user.email}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {user.roles.map((r) => (
                          <Badge key={r} variant="info" className="font-mono text-[11px]">
                            {r}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[18rem] font-mono text-[11px] text-muted-foreground">{effective_scopes.join(' ')}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(user)}>
                        <Pencil aria-hidden />
                        <span className="sr-only">
                          {t('users.editFor', { name: user.name })}
                        </span>
                        <span aria-hidden>{t('users.edit')}</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {editing && data && <RolesDialog user={editing} roles={data.roles} onClose={() => setEditing(null)} onSaved={load} />}
    </section>
  );
}
