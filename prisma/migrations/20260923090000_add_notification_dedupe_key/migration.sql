-- Ensure batch license scans cannot create duplicate org notifications for
-- the same stable notification type/message.
DELETE FROM "Notification"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "orgId", "type", "message"
        ORDER BY "createdAt" ASC, "id" ASC
      ) AS row_number
    FROM "Notification"
    WHERE "orgId" IS NOT NULL
  ) duplicates
  WHERE duplicates.row_number > 1
);

CREATE UNIQUE INDEX "Notification_orgId_type_message_key"
ON "Notification"("orgId", "type", "message");
