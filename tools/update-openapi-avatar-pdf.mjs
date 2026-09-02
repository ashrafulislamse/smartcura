import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const openapiPath = join(__dirname, '../apps/api/packages/contracts/openapi/openapi.json');
const doc = JSON.parse(readFileSync(openapiPath, 'utf8'));

// Add avatar_url to Profile schema (optional, nullable)
doc.components.schemas.Profile.properties.avatar_url = {
  type: ['string', 'null'],
  format: 'uri',
};

// New schemas for avatar and prescription PDF
doc.components.schemas.AvatarUploadRequest = {
  type: 'object',
  additionalProperties: false,
  required: ['content_type', 'byte_size', 'declared_sha256'],
  properties: {
    content_type: {
      type: 'string',
      enum: ['image/jpeg', 'image/png', 'image/webp'],
    },
    byte_size: {
      type: 'integer',
      minimum: 1,
      maximum: 5 * 1024 * 1024,
    },
    declared_sha256: {
      type: 'string',
      pattern: '^[0-9a-f]{64}$',
    },
  },
};

doc.components.schemas.AvatarUploadResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['object_id', 'upload'],
  properties: {
    object_id: {
      $ref: '#/components/schemas/UuidV7',
    },
    upload: {
      type: 'object',
      additionalProperties: false,
      required: ['method', 'url', 'expires_at', 'required_headers'],
      properties: {
        method: {
          type: 'string',
          enum: ['GET', 'PUT'],
        },
        url: {
          type: 'string',
          format: 'uri',
        },
        expires_at: {
          $ref: '#/components/schemas/Timestamp',
        },
        required_headers: {
          type: 'object',
          additionalProperties: {
            type: 'string',
          },
        },
      },
    },
  },
};

doc.components.schemas.AvatarFinalizeRequest = {
  type: 'object',
  additionalProperties: false,
  required: ['object_id', 'sha256'],
  properties: {
    object_id: {
      $ref: '#/components/schemas/UuidV7',
    },
    sha256: {
      type: 'string',
      pattern: '^[0-9a-f]{64}$',
    },
  },
};

doc.components.schemas.AvatarFinalizeResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['object_id', 'finalized_at'],
  properties: {
    object_id: {
      $ref: '#/components/schemas/UuidV7',
    },
    finalized_at: {
      $ref: '#/components/schemas/Timestamp',
    },
  },
};

doc.components.schemas.AvatarDownloadResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['download_url', 'expires_at'],
  properties: {
    download_url: {
      type: 'string',
      format: 'uri',
    },
    expires_at: {
      $ref: '#/components/schemas/Timestamp',
    },
  },
};

doc.components.schemas.PrescriptionPdfResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['download_url', 'expires_at'],
  properties: {
    download_url: {
      type: 'string',
      format: 'uri',
    },
    expires_at: {
      $ref: '#/components/schemas/Timestamp',
    },
  },
};

// Path definitions
const avatarUploadPath = {
  post: {
    operationId: 'requestAvatarUpload',
    tags: ['Profiles'],
    summary: 'Request a pre-signed upload for the authenticated profile avatar',
    parameters: [
      {
        $ref: '#/components/parameters/CsrfToken',
      },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            $ref: '#/components/schemas/AvatarUploadRequest',
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Upload target created',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/AvatarUploadResponse',
            },
          },
        },
      },
      401: {
        $ref: '#/components/responses/AppSessionInvalid',
      },
      403: {
        $ref: '#/components/responses/Forbidden',
      },
      422: {
        $ref: '#/components/responses/ValidationFailed',
      },
      503: {
        $ref: '#/components/responses/ServiceUnavailable',
      },
    },
  },
};

const avatarDownloadPath = {
  get: {
    operationId: 'downloadAvatar',
    tags: ['Profiles'],
    summary: 'Get a pre-signed download URL for the authenticated profile avatar',
    responses: {
      200: {
        description: 'Avatar download URL',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/AvatarDownloadResponse',
            },
          },
        },
      },
      204: {
        description: 'No avatar is set',
      },
      401: {
        $ref: '#/components/responses/AppSessionInvalid',
      },
      403: {
        $ref: '#/components/responses/Forbidden',
      },
      503: {
        $ref: '#/components/responses/ServiceUnavailable',
      },
    },
  },
};

const avatarFinalizePath = {
  post: {
    operationId: 'finalizeAvatarUpload',
    tags: ['Profiles'],
    summary: 'Finalize the authenticated profile avatar upload',
    parameters: [
      {
        $ref: '#/components/parameters/CsrfToken',
      },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            $ref: '#/components/schemas/AvatarFinalizeRequest',
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Avatar finalized',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/AvatarFinalizeResponse',
            },
          },
        },
      },
      401: {
        $ref: '#/components/responses/AppSessionInvalid',
      },
      403: {
        $ref: '#/components/responses/Forbidden',
      },
      404: {
        $ref: '#/components/responses/NotFound',
      },
      409: {
        $ref: '#/components/responses/Conflict',
      },
      422: {
        $ref: '#/components/responses/ValidationFailed',
      },
      503: {
        $ref: '#/components/responses/ServiceUnavailable',
      },
    },
  },
};

const prescriptionPdfPath = {
  get: {
    operationId: 'getPrescriptionPdf',
    tags: ['Consultations'],
    summary: 'Download a signed-prescription PDF',
    parameters: [
      {
        name: 'prescription_id',
        in: 'path',
        required: true,
        schema: {
          $ref: '#/components/schemas/UuidV7',
        },
      },
    ],
    responses: {
      200: {
        description: 'Prescription PDF download URL',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/PrescriptionPdfResponse',
            },
          },
        },
      },
      401: {
        $ref: '#/components/responses/AppSessionInvalid',
      },
      403: {
        $ref: '#/components/responses/Forbidden',
      },
      404: {
        $ref: '#/components/responses/NotFound',
      },
      503: {
        $ref: '#/components/responses/ServiceUnavailable',
      },
    },
  },
};

// Insert paths in order
const orderedPaths = {};
for (const [key, value] of Object.entries(doc.paths)) {
  orderedPaths[key] = value;
  if (key === '/profiles/me') {
    orderedPaths['/profiles/me/avatar'] = { ...avatarUploadPath, ...avatarDownloadPath };
    orderedPaths['/profiles/me/avatar/finalize'] = avatarFinalizePath;
  }
  if (key === '/prescriptions/{prescription_id}') {
    orderedPaths['/prescriptions/{prescription_id}/pdf'] = prescriptionPdfPath;
  }
}
doc.paths = orderedPaths;

writeFileSync(openapiPath, JSON.stringify(doc, null, 2) + '\n');
console.log('OpenAPI updated successfully');
