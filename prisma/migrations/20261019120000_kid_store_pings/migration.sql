-- Kids' bell: a grown-up handled their store order, or gave or took stickers. Postgres 17,
-- so two enum values in one migration is fine.
ALTER TYPE "NotificationKind" ADD VALUE 'ORDER_UPDATED';
ALTER TYPE "NotificationKind" ADD VALUE 'STICKERS_ADJUSTED';
