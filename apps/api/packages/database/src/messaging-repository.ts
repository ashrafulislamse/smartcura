import type { PoolClient, QueryResultRow } from 'pg';
import { PostgresConnection } from './connection.js';
import {
  MESSAGE_CREATED_EVENT_TYPE, MESSAGE_CREATED_EVENT_VERSION,
  RECEIPT_UPDATED_EVENT_TYPE, RECEIPT_UPDATED_EVENT_VERSION,
} from './consultation-events.js';
import {
  revalidateClinicalActor,
  type ClinicalActorContext,
  type ClinicalActorFailure,
} from './clinical-actor.js';
import { createNotification } from './notification-repository.js';

export type MessageType = 'text' | 'file' | 'system';
export interface ConversationInboxRecord {
  readonly conversationId: string;
  readonly consultationId: string;
  readonly patientProfileId: string;
  readonly status: 'active' | 'closed';
  readonly latestMessageId: string | null;
  readonly latestMessageAt: Date | null;
  readonly updatedAt: Date;
  readonly unreadCount: number;
}

export interface MessageRecord {
  readonly messageId: string;
  readonly conversationId: string;
  readonly senderProfileId: string;
  readonly sequenceNo: number;
  readonly clientCorrelationId: string;
  readonly messageType: MessageType;
  readonly textContent: string | null;
  readonly fileObjectId: string | null;
  readonly createdAt: Date;
  readonly deliveredAt: Date | null;
  readonly readAt: Date | null;
}
interface MessageRow extends QueryResultRow, MessageRecord {}
interface ConversationInboxRow extends QueryResultRow, ConversationInboxRecord {}
interface ConversationRow extends QueryResultRow {
  readonly conversationId: string;
  readonly organizationId: string;
  readonly status: string;
  readonly participant: boolean;
}

export type SendMessageFailure = ClinicalActorFailure | 'not_found' | 'not_participant' |
  'conversation_closed' | 'correlation_reused' | 'file_not_clean';

const projection = `message.message_id AS "messageId",
  message.conversation_id AS "conversationId", message.sender_profile_id AS "senderProfileId",
  message.sequence_no::integer AS "sequenceNo",
  message.client_correlation_id AS "clientCorrelationId", message.message_type AS "messageType",
  message.text_content AS "textContent", message.file_object_id AS "fileObjectId",
  message.created_at AS "createdAt", receipt.delivered_at AS "deliveredAt", receipt.read_at AS "readAt"`;

export function serializeMessage(record: MessageRecord, viewerProfileId: string): Record<string, unknown> {
  return {
    message_id: record.messageId,
    conversation_id: record.conversationId,
    sender_profile_id: record.senderProfileId,
    sequence_no: record.sequenceNo,
    client_correlation_id: record.clientCorrelationId,
    message_type: record.messageType,
    text_content: record.textContent,
    file_object_id: record.fileObjectId,
    is_me: record.senderProfileId === viewerProfileId,
    delivered_at: record.deliveredAt?.toISOString() ?? null,
    read_at: record.readAt?.toISOString() ?? null,
    created_at: record.createdAt.toISOString(),
  };
}

export class MessagingRepository {
  constructor(private readonly database: PostgresConnection) {}

  async listDoctorInbox(input: {
    profileId: string; membershipId: string; afterUpdatedAt?: Date; afterId?: string; limit: number;
  }): Promise<ConversationInboxRecord[]> {
    return (await this.database.query<ConversationInboxRow>(
      `SELECT conversation.conversation_id AS "conversationId",
         conversation.consultation_id AS "consultationId",
         consultation.patient_profile_id AS "patientProfileId",
         conversation.status,
         conversation.updated_at AS "updatedAt",
         latest.message_id AS "latestMessageId", latest.created_at AS "latestMessageAt",
         (SELECT count(*)::integer FROM message_receipts unread
          JOIN messages unread_message ON unread_message.message_id = unread.message_id
          WHERE unread.profile_id = $1 AND unread.read_at IS NULL
            AND unread_message.conversation_id = conversation.conversation_id) AS "unreadCount"
       FROM conversations conversation
       JOIN consultations consultation ON consultation.consultation_id = conversation.consultation_id
       LEFT JOIN LATERAL (
         SELECT message_id, created_at FROM messages
         WHERE conversation_id = conversation.conversation_id
         ORDER BY sequence_no DESC, message_id DESC LIMIT 1
       ) latest ON true
       WHERE consultation.doctor_membership_id = $2
         AND ($3::timestamptz IS NULL OR (conversation.updated_at,conversation.conversation_id) < ($3,$4))
       ORDER BY conversation.updated_at DESC, conversation.conversation_id DESC LIMIT $5`,
      [input.profileId, input.membershipId, input.afterUpdatedAt ?? null, input.afterId ?? null, input.limit],
    )).rows;
  }

  async conversationForConsultation(
    consultationId: string, profileId: string,
  ): Promise<{ conversationId: string; status: string } | undefined> {
    return (await this.database.query<{ conversationId: string; status: string }>(
      `SELECT conversation.conversation_id AS "conversationId", conversation.status
       FROM conversations conversation
       JOIN conversation_participants participant
         ON participant.conversation_id = conversation.conversation_id
       WHERE conversation.consultation_id = $1 AND participant.profile_id = $2`,
      [consultationId, profileId],
    )).rows[0];
  }

  /**
   * Whether a profile is an active participant in a conversation. Used by the
   * WebSocket chat gateway to authorize a `join` command before
   * `client.join(conversationId)`. A participant row whose `archived_at` is set
   * is no longer active and must not be admitted, so the gateway does not become
   * a route by which a former participant receives live messages.
   */
  async isParticipant(conversationId: string, profileId: string): Promise<boolean> {
    const result = await this.database.query(
      `SELECT 1 FROM conversation_participants
       WHERE conversation_id = $1 AND profile_id = $2 AND archived_at IS NULL`,
      [conversationId, profileId],
    );
    return result.rowCount === 1;
  }

  /**
   * The profile_ids of the active participants in one conversation. The gateway
   * uses this to broadcast presence changes to the right per-participant user
   * rooms without enumerating every profile in the system.
   */
  async participantProfileIds(conversationId: string): Promise<string[]> {
    const result = await this.database.query<{ profileId: string }>(
      `SELECT profile_id AS "profileId" FROM conversation_participants
       WHERE conversation_id = $1 AND archived_at IS NULL`,
      [conversationId],
    );
    return result.rows.map((row) => row.profileId);
  }

  /**
   * The conversation_ids a profile is an active participant in. The WebSocket
   * chat gateway uses this to scope a presence broadcast to the conversation
   * rooms that should see it, without enumerating every conversation in the
   * system. An archived participant is excluded so a former member does not
   * receive presence for a conversation they left.
   */
  async conversationsForProfile(profileId: string): Promise<string[]> {
    const result = await this.database.query<{ conversationId: string }>(
      `SELECT conversation_id AS "conversationId" FROM conversation_participants
       WHERE profile_id = $1 AND archived_at IS NULL`,
      [profileId],
    );
    return result.rows.map((row) => row.conversationId);
  }

  async list(input: {
    conversationId: string; profileId: string; afterSequenceNo?: number;
    afterId?: string; limit: number;
  }): Promise<MessageRecord[] | 'not_participant'> {
    const participant = await this.database.query(
      `SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND profile_id = $2`,
      [input.conversationId, input.profileId],
    );
    if (participant.rowCount !== 1) return 'not_participant';
    return (await this.database.query<MessageRow>(
      `SELECT ${projection} FROM messages message
       LEFT JOIN message_receipts receipt
         ON receipt.message_id = message.message_id AND receipt.profile_id = $2
       WHERE message.conversation_id = $1 AND
         ($3::bigint IS NULL OR (message.sequence_no,message.message_id) > ($3,$4))
       ORDER BY message.sequence_no ASC, message.message_id ASC LIMIT $5`,
      [input.conversationId, input.profileId, input.afterSequenceNo ?? null,
        input.afterId ?? null, input.limit],
    )).rows;
  }

  async send(input: {
    conversationId: string; messageType: Extract<MessageType, 'text' | 'file'>;
    textContent: string | null; fileObjectId: string | null; clientCorrelationId: string;
    actor: ClinicalActorContext; now: Date; correlationId: string;
  }): Promise<MessageRecord | SendMessageFailure> {
    return this.database.transaction(async (client) => {
      const actorFailure = await revalidateClinicalActor(client, input.actor, input.now);
      if (actorFailure !== undefined) return actorFailure;
      const conversation = (await client.query<ConversationRow>(
        `SELECT conversation.conversation_id AS "conversationId",
           conversation.organization_id AS "organizationId", conversation.status,
           EXISTS (SELECT 1 FROM conversation_participants participant
             WHERE participant.conversation_id = conversation.conversation_id
               AND participant.profile_id = $2) AS participant
         FROM conversations conversation WHERE conversation.conversation_id = $1 FOR UPDATE`,
        [input.conversationId, input.actor.profileId],
      )).rows[0];
      if (conversation === undefined) return 'not_found';
      if (!conversation.participant) return 'not_participant';
      if (conversation.status !== 'active') return 'conversation_closed';
      const existing = (await client.query<MessageRow>(
        `SELECT ${projection} FROM messages message
         LEFT JOIN message_receipts receipt
           ON receipt.message_id = message.message_id AND receipt.profile_id = $2
         WHERE message.conversation_id = $1 AND message.sender_profile_id = $2
           AND message.client_correlation_id = $3`,
        [input.conversationId, input.actor.profileId, input.clientCorrelationId],
      )).rows[0];
      if (existing !== undefined) {
        const same = existing.messageType === input.messageType &&
          existing.textContent === input.textContent && existing.fileObjectId === input.fileObjectId;
        return same ? existing : 'correlation_reused';
      }
      if (input.fileObjectId !== null) {
        const clean = await client.query(
          `SELECT 1 FROM stored_objects WHERE object_id = $1
             AND upload_state = 'finalized' AND scan_state = 'clean'`,
          [input.fileObjectId],
        );
        if (clean.rowCount !== 1) return 'file_not_clean';
      }
      const sequence = (await client.query<{ sequenceNo: number }>(
        `UPDATE conversations SET next_sequence_no = next_sequence_no + 1, updated_at = $2
         WHERE conversation_id = $1 RETURNING (next_sequence_no - 1)::integer AS "sequenceNo"`,
        [input.conversationId, input.now],
      )).rows[0]!.sequenceNo;
      const message = (await client.query<MessageRow>(
        `WITH inserted AS (
           INSERT INTO messages
           (conversation_id,sender_profile_id,sequence_no,client_correlation_id,
            message_type,text_content,file_object_id,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
         ) SELECT inserted.message_id AS "messageId", inserted.conversation_id AS "conversationId",
           inserted.sender_profile_id AS "senderProfileId", inserted.sequence_no::integer AS "sequenceNo",
           inserted.client_correlation_id AS "clientCorrelationId", inserted.message_type AS "messageType",
           inserted.text_content AS "textContent", inserted.file_object_id AS "fileObjectId",
           inserted.created_at AS "createdAt", NULL::timestamptz AS "deliveredAt",
           NULL::timestamptz AS "readAt" FROM inserted`,
        [input.conversationId, input.actor.profileId, sequence, input.clientCorrelationId,
          input.messageType, input.textContent, input.fileObjectId, input.now],
      )).rows[0]!;
      await client.query(
        `INSERT INTO message_receipts (message_id,profile_id,delivered_at)
         SELECT $1,profile_id,$2 FROM conversation_participants
         WHERE conversation_id = $3 AND profile_id <> $4`,
        [message.messageId, input.now, input.conversationId, input.actor.profileId],
      );
      const recipients = await client.query<{ profileId: string }>(
        `SELECT profile_id AS "profileId" FROM conversation_participants
         WHERE conversation_id = $1 AND profile_id <> $2`,
        [input.conversationId, input.actor.profileId],
      );
      for (const recipient of recipients.rows) {
        await createNotification(client, {
          profileId: recipient.profileId, category: 'messages', resourceType: 'conversation',
          resourceId: input.conversationId, titleCode: 'message.new.title',
          bodyCode: 'message.new.body', correlationId: input.correlationId, now: input.now,
        });
      }
      await client.query(
        `INSERT INTO outbox_events
         (event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,
          payload,correlation_id,occurred_at)
         VALUES (uuidv7(),$1,$2,'conversation',$3,$4,$5::jsonb,$6,$7)`,
        [MESSAGE_CREATED_EVENT_TYPE, MESSAGE_CREATED_EVENT_VERSION, input.conversationId,
          sequence, JSON.stringify({
            conversation_id: input.conversationId,
            message_id: message.messageId,
            sender_profile_id: input.actor.profileId,
            sequence_no: sequence,
            message_type: input.messageType,
          }), input.correlationId, input.now],
      );
      await this.audit(client, conversation.organizationId, input.actor.profileId,
        message.messageId, input.correlationId, input.now);
      return message;
    });
  }

  async markRead(input: {
    conversationId: string; throughSequenceNo: number; actor: ClinicalActorContext;
    now: Date; correlationId: string;
  }): Promise<number | SendMessageFailure> {
    return this.database.transaction(async (client) => {
      const actorFailure = await revalidateClinicalActor(client, input.actor, input.now);
      if (actorFailure !== undefined) return actorFailure;
      const participant = await client.query<{ organizationId: string }>(
        `SELECT conversation.organization_id AS "organizationId"
         FROM conversation_participants participant
         JOIN conversations conversation ON conversation.conversation_id = participant.conversation_id
         WHERE participant.conversation_id = $1 AND participant.profile_id = $2
         FOR UPDATE OF participant`,
        [input.conversationId, input.actor.profileId],
      );
      if (participant.rowCount !== 1) return 'not_participant';
      const changed = await client.query(
        `UPDATE message_receipts receipt SET read_at = COALESCE(receipt.read_at,$4)
         FROM messages message
         WHERE receipt.message_id = message.message_id
           AND receipt.profile_id = $2 AND message.conversation_id = $1
           AND message.sequence_no <= $3`,
        [input.conversationId, input.actor.profileId, input.throughSequenceNo, input.now],
      );
      const count = changed.rowCount ?? 0;
      if (count > 0) {
        await client.query(
          `INSERT INTO outbox_events
           (event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,
            payload,correlation_id,occurred_at)
           VALUES (uuidv7(),$1,$2,'conversation',$3,$4,$5::jsonb,$6,$7)`,
          [RECEIPT_UPDATED_EVENT_TYPE, RECEIPT_UPDATED_EVENT_VERSION,
            input.conversationId, input.throughSequenceNo,
            JSON.stringify({ conversation_id: input.conversationId,
              profile_id: input.actor.profileId, through_sequence_no: input.throughSequenceNo }),
            input.correlationId, input.now],
        );
      }
      return count;
    });
  }

  private async audit(
    client: PoolClient, organizationId: string, actorProfileId: string,
    messageId: string, correlationId: string, now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
       (audit_id,organization_id,actor_profile_id,action,object_type,object_id,correlation_id,occurred_at)
       VALUES (uuidv7(),$1,$2,'conversation.message.created','message',$3,$4,$5)`,
      [organizationId, actorProfileId, messageId, correlationId, now],
    );
  }
}
