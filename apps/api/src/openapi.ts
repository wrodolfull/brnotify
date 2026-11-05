export const openApiDefinition = {
  "openapi": "3.1.0",
  "info": {
    "title": "BR Notify Public API",
    "version": "1.0.0",
    "description": "Integrações REST multitenant. Chaves por ambiente, paginação de 20 itens, deduplicação por external_id. Todas as datas locais seguem o fuso do ambiente. Sem cadastro público."
  },
  "servers": [
    {
      "url": "/v1"
    }
  ],
  "components": {
    "securitySchemes": {
      "ApiKeyBearer": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "brn_live_<64 hex>",
        "description": "Chave criada em BR Notify → API e Integrações; exibida somente uma vez."
      }
    },
    "schemas": {
      "ReminderUpsert": {
        "type": "object",
        "properties": {
          "external_id": {
            "type": "string",
            "example": "REV-2026-1045"
          },
          "contact": {
            "type": "object",
            "required": [
              "name",
              "phone"
            ],
            "properties": {
              "external_id": {
                "type": "string",
                "example": "client-102"
              },
              "name": {
                "type": "string",
                "example": "Carlos Silva"
              },
              "phone": {
                "type": "string",
                "example": "+5519999999999"
              },
              "consent": {
                "type": "boolean",
                "example": true
              },
              "consent_source": {
                "type": "string",
                "example": "Agendamento no CRM"
              },
              "email": {
                "type": "string"
              }
            }
          },
          "record": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "example": "vehicle"
              },
              "external_id": {
                "type": "string",
                "example": "vehicle-ABC1D23"
              },
              "label": {
                "type": "string",
                "example": "Corolla"
              },
              "model": {
                "type": "string",
                "example": "Corolla"
              },
              "plate": {
                "type": "string",
                "example": "ABC1D23"
              },
              "details": {
                "type": "object"
              }
            }
          },
          "event": {
            "type": "object",
            "required": [
              "title",
              "date"
            ],
            "properties": {
              "title": {
                "type": "string",
                "example": "Revisão"
              },
              "type": {
                "type": "string",
                "example": "revisao"
              },
              "date": {
                "type": "string",
                "format": "date",
                "example": "2026-12-15"
              },
              "time": {
                "type": "string",
                "example": "09:00"
              },
              "confirmation_enabled": {
                "type": "boolean",
                "description": "Permite associar respostas SIM, REAGENDAR e CANCELAR AGENDAMENTO de forma conservadora"
              },
              "details": {
                "type": "object"
              }
            }
          },
          "reminders": {
            "type": "array",
            "minItems": 0,
            "maxItems": 3,
            "items": {
              "type": "object",
              "required": [
                "before",
                "unit"
              ],
              "properties": {
                "before": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 365
                },
                "unit": {
                  "type": "string",
                  "enum": [
                    "days",
                    "weeks",
                    "months"
                  ]
                },
                "enabled": {
                  "type": "boolean"
                },
                "send_time": {
                  "type": "string",
                  "example": "09:00"
                }
              }
            }
          }
        },
        "required": [
          "external_id",
          "contact",
          "event"
        ]
      },
      "Error": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          }
        }
      }
    }
  },
  "tags": [
    {
      "name": "Contatos"
    },
    {
      "name": "Agendamentos"
    },
    {
      "name": "Importações"
    },
    {
      "name": "Disparos"
    }
  ],
  "security": [
    {
      "ApiKeyBearer": []
    }
  ],
  "paths": {
    "/contacts": {
      "get": {
        "tags": [
          "Contatos"
        ],
        "summary": "Lista contatos (20 por página)",
        "description": "Escopo contacts:read",
        "parameters": [
          {
            "name": "page",
            "in": "query",
            "schema": {
              "type": "integer",
              "minimum": 1,
              "default": 1
            }
          },
          {
            "name": "q",
            "in": "query",
            "schema": {
              "type": "string",
              "maxLength": 80
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Lista paginada",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "401": {
            "description": "Chave inválida",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "403": {
            "description": "Escopo negado",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          }
        }
      },
      "post": {
        "tags": [
          "Contatos"
        ],
        "summary": "Cria ou atualiza contato",
        "description": "Escopo contacts:write. Não reativa opt-out automaticamente.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "name",
                  "phone"
                ],
                "properties": {
                  "external_id": {
                    "type": "string",
                    "example": "client-102"
                  },
                  "name": {
                    "type": "string",
                    "example": "Carlos Silva"
                  },
                  "phone": {
                    "type": "string",
                    "example": "+5519999999999"
                  },
                  "consent": {
                    "type": "boolean",
                    "example": true
                  },
                  "consent_source": {
                    "type": "string",
                    "example": "Agendamento no CRM"
                  },
                  "email": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Contato persistido",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "422": {
            "description": "Consentimento ausente",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          }
        }
      }
    },
    "/contacts/{id}": {
      "patch": {
        "tags": [
          "Contatos"
        ],
        "summary": "Atualiza contato pelo UUID interno",
        "description": "Escopo contacts:write. Permitido revogar consentimento; reativação após opt-out exige revisão administrativa.",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Contato atualizado",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          }
        }
      }
    },
    "/reminders": {
      "post": {
        "tags": [
          "Agendamentos"
        ],
        "summary": "Upsert completo: contato + registro + evento + até três lembretes",
        "description": "Escopos events:write e contacts:write. external_id permite repetir a requisição sem duplicar eventos.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/ReminderUpsert"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Evento atualizado",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "201": {
            "description": "Evento criado",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "409": {
            "description": "Conflito de contato",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "422": {
            "description": "Dados inválidos",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          }
        }
      }
    },
    "/events": {
      "get": {
        "tags": [
          "Agendamentos"
        ],
        "summary": "Lista agendamentos (20 por página)",
        "description": "Escopo events:read",
        "parameters": [
          {
            "name": "page",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 1
            }
          },
          {
            "name": "status",
            "in": "query",
            "schema": {
              "type": "string",
              "enum": [
                "scheduled",
                "cancelled",
                "completed"
              ]
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Resultados paginados",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          }
        }
      },
      "post": {
        "tags": [
          "Agendamentos"
        ],
        "summary": "Alias de POST /reminders",
        "description": "Escopos events:write e contacts:write",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/ReminderUpsert"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Evento atualizado",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "201": {
            "description": "Evento criado",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          }
        }
      }
    },
    "/events/{externalId}": {
      "parameters": [
        {
          "name": "externalId",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string",
            "maxLength": 120
          }
        }
      ],
      "get": {
        "tags": [
          "Agendamentos"
        ],
        "summary": "Consulta agendamento e três status de lembrete",
        "description": "Escopo events:read",
        "responses": {
          "200": {
            "description": "Detalhes",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "404": {
            "description": "Não encontrado",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          }
        }
      },
      "patch": {
        "tags": [
          "Agendamentos"
        ],
        "summary": "Reagenda ou altera solicitação de confirmação",
        "description": "Escopo events:write",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "date": {
                    "type": "string",
                    "format": "date"
                  },
                  "time": {
                    "type": "string",
                    "example": "09:00"
                  },
                  "title": {
                    "type": "string"
                  },
                  "confirmation_enabled": {
                    "type": "boolean"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Evento atualizado",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          }
        }
      }
    },
    "/events/{externalId}/cancel": {
      "post": {
        "tags": [
          "Agendamentos"
        ],
        "summary": "Cancela agendamento e futuros lembretes",
        "description": "Escopo events:write",
        "parameters": [
          {
            "name": "externalId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Cancelado",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          }
        }
      }
    },
    "/reminders/{externalId}": {
      "get": {
        "tags": [
          "Agendamentos"
        ],
        "summary": "Consulta detalhes de um lembrete por external_id",
        "description": "Escopo events:read",
        "parameters": [
          {
            "name": "externalId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Detalhes",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          }
        }
      }
    },
    "/imports": {
      "post": {
        "tags": [
          "Importações"
        ],
        "summary": "Importa lote JSON de até 50 eventos",
        "description": "Escopos imports:write, events:write e contacts:write. A resposta 207 inclui sucesso parcial e erros por item.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "items"
                ],
                "properties": {
                  "items": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 50,
                    "items": {
                      "$ref": "#/components/schemas/ReminderUpsert"
                    }
                  }
                }
              }
            }
          }
        },
        "responses": {
          "207": {
            "description": "Importação parcial/concluída",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          }
        }
      }
    },
    "/imports/{id}": {
      "get": {
        "tags": [
          "Importações"
        ],
        "summary": "Consulta resultado de importação",
        "description": "Escopo events:read",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Resultado",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          }
        }
      }
    },
    "/messages/send": {
      "post": {
        "tags": [
          "Disparos"
        ],
        "summary": "Enfileirar template WhatsApp da URA sem Call ID",
        "description": "Escopo messages:send. Header Authorization: Bearer brn_live_... do ambiente. Requer escolha explícita do usuário na URA; duplicatas idênticas em 120 segundos retornam mesmo request_id.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "to",
                  "template",
                  "consent"
                ],
                "properties": {
                  "to": {
                    "type": "string",
                    "example": "+5519999999999"
                  },
                  "template": {
                    "type": "string",
                    "example": "continuar_atendimento_whatsapp"
                  },
                  "language": {
                    "type": "string",
                    "example": "pt_BR"
                  },
                  "name": {
                    "type": "string",
                    "example": "Cliente"
                  },
                  "variables": {
                    "type": "object",
                    "additionalProperties": {
                      "type": "string"
                    },
                    "example": {
                      "body.parameter_0": "Atendimento"
                    }
                  },
                  "media_asset_id": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "consent": {
                    "type": "object",
                    "required": [
                      "confirmed",
                      "source"
                    ],
                    "properties": {
                      "confirmed": {
                        "type": "boolean",
                        "const": true
                      },
                      "source": {
                        "type": "string",
                        "enum": [
                          "ivr_option_whatsapp",
                          "explicit_customer_request"
                        ]
                      }
                    }
                  }
                }
              }
            }
          }
        },
        "responses": {
          "202": {
            "description": "Pedido enfileirado ou deduplicado; não garante entrega"
          },
          "401": {
            "description": "Token inválido"
          },
          "403": {
            "description": "Permissão negada"
          },
          "409": {
            "description": "Conexão GoTo indisponível ou contato com opt-out"
          },
          "422": {
            "description": "Payload inválido ou template não aprovado"
          },
          "429": {
            "description": "Limite de envios por telefone"
          }
        }
      }
    },
    "/messages/send/{id}": {
      "get": {
        "tags": [
          "Disparos"
        ],
        "summary": "Consultar status do pedido da URA",
        "description": "Escopo messages:send; exige a mesma chave que criou o pedido.",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Estado queued,processing,sent,delivered,failed,unknown,cancelled"
          },
          "404": {
            "description": "Pedido não encontrado"
          }
        }
      }
    },
    "/messages": {
      "get": {
        "tags": [
          "Disparos"
        ],
        "summary": "Lista status de disparos (20 por página)",
        "description": "Escopo messages:read",
        "parameters": [
          {
            "name": "external_id",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "page",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 1
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Resultados paginados",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          }
        }
      }
    }
  }
};
