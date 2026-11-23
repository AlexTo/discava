/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Badge } from '@discava/common-shadcn/components/ui/badge';
import type { CouponStatus } from './coupon-format';

const LABELS: Record<CouponStatus, string> = {
  active: 'Active',
  disabled: 'Disabled',
  expired: 'Expired',
  'used up': 'Used up',
};

const STYLES: Record<CouponStatus, string> = {
  active: 'bg-emerald-100 text-emerald-900',
  disabled: 'bg-muted text-muted-foreground',
  expired: 'bg-amber-100 text-amber-900',
  'used up': 'bg-amber-100 text-amber-900',
};

export function CouponStatusBadge({ status }: { status: CouponStatus }) {
  return <Badge className={STYLES[status]}>{LABELS[status]}</Badge>;
}
