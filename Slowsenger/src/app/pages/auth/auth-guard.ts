import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from '../../core/supabase/supabase.service';

export const authGuard: CanActivateFn = async (route, state) => {
  const supabase = inject(SupabaseService);
  const router = inject(Router);

  // Kifejezetten megvárjuk a Supabase válaszát a local storage-ből / szerverről
  const { data: { session } } = await supabase.getSession();

  if (session) {
    // Van aktív munkamenet, beengedjük a Dashboardra
    return true; 
  }

  // Nincs munkamenet, visszadobjuk a loginra
  router.navigate(['/auth/login']);
  return false;
};