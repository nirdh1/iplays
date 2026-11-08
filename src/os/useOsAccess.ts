import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { v2Enabled, v2Pilot } from './env';

export type OsAccess = 'yes' | 'no' | 'checking';

/**
 * May this signed-in account open Club OS? Staging: yes. Production pilot: only
 * if the server says so (os_pilot_enabled). Anything else, or any error: no.
 * The real protection is RLS on every table; this only decides what is shown.
 */
export function useOsAccess(userId: string | null | undefined): OsAccess {
  const [state, setState] = useState<{ user: string | null; access: OsAccess }>({ user: null, access: 'checking' });
  useEffect(() => {
    if (!v2Pilot || !userId || !supabase) return;
    let live = true;
    Promise.resolve(supabase.rpc('os_pilot_enabled'))
      .then(({ data, error }) => live && setState({ user: userId, access: !error && data === true ? 'yes' : 'no' }))
      .catch(() => live && setState({ user: userId, access: 'no' }));
    return () => {
      live = false;
    };
  }, [userId]);
  if (v2Enabled) return 'yes';
  if (!v2Pilot || !userId) return 'no';
  return state.user === userId ? state.access : 'checking';
}
