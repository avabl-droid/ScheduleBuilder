const { run } = require('../db/query');

async function createNotification({
  userId,
  teamId = null,
  notificationType,
  subject,
  message,
  metadata = null,
  channel = 'email',
  status = 'queued',
}) {
  const result = await run(
    `
      INSERT INTO notifications (
        user_id,
        team_id,
        notification_type,
        channel,
        subject,
        message,
        metadata_json,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      teamId,
      notificationType,
      channel,
      subject,
      message,
      metadata ? JSON.stringify(metadata) : null,
      status,
    ]
  );

  return result.lastID;
}

module.exports = {
  createNotification,
};
