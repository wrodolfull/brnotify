/** Curated human-readable descriptions and examples for the published /v1 OpenAPI operations. */
export type DocsVariant={id:string;label:string;description?:string;body?:unknown;query?:string;pathParams?:Record<string,string>;response?:unknown};
export type DocsMeta={title:string;description:string;scope:string[];hints:string[];variants:DocsVariant[];response?:unknown};
export const endpointDocs:Record<string,DocsMeta>={
  "GET /contacts": {
    "title": "Listar contatos",
    "description": "Consulte os contatos registrados no ambiente. É possível filtrar pelo nome ou telefone.",
    "scope": [
      "contacts:read"
    ],
    "hints": [
      "A lista retorna até 20 contatos por página.",
      "Todos os resultados pertencem ao ambiente associado ao token."
    ],
    "variants": [
      {
        "id": "all",
        "label": "Todos",
        "query": "page=1",
        "response": {
          "items": [
            {
              "id": "00000000-0000-4000-8000-000000000001",
              "name": "Carlos Silva",
              "phone": "+5519999999999",
              "consent": true
            }
          ],
          "total": 1,
          "page": 1,
          "pages": 1
        }
      },
      {
        "id": "filter",
        "label": "Buscar contato",
        "query": "q=Carlos&page=1",
        "response": {
          "items": [
            {
              "name": "Carlos Silva",
              "phone": "+5519999999999"
            }
          ],
          "total": 1,
          "page": 1,
          "pages": 1
        }
      }
    ]
  },
  "POST /contacts": {
    "title": "Criar ou atualizar contato",
    "description": "Cadastre contatos vindos do CRM, ERP ou outra aplicação. Um external_id pode identificar o mesmo cliente nas próximas sincronizações.",
    "scope": [
      "contacts:write"
    ],
    "hints": [
      "Informe consentimento somente quando houver uma base válida para o contato.",
      "Um contato que realizou opt-out não é reativado automaticamente."
    ],
    "variants": [
      {
        "id": "basic",
        "label": "Cadastro básico",
        "body": {
          "external_id": "cliente-102",
          "name": "Carlos Silva",
          "phone": "+5519999999999",
          "consent": true,
          "consent_source": "Solicitação no CRM"
        },
        "description": "Contato com identificação externa"
      },
      {
        "id": "custom",
        "label": "Dados adicionais",
        "body": {
          "external_id": "cliente-102",
          "name": "Carlos Silva",
          "phone": "+5519999999999",
          "email": "carlos@example.com",
          "custom_data": {
            "loja": "Campinas",
            "segmento": "pos-venda"
          }
        },
        "description": "Campos personalizados"
      }
    ],
    "response": {
      "id": "00000000-0000-4000-8000-000000000001",
      "external_id": "cliente-102",
      "name": "Carlos Silva",
      "phone": "+5519999999999",
      "consent": true,
      "opted_out": false
    }
  },
  "PATCH /contacts/{id}": {
    "title": "Atualizar contato",
    "description": "Altere dados de um contato usando o UUID interno retornado pelo BR Notify.",
    "scope": [
      "contacts:write"
    ],
    "hints": [
      "O identificador externo previamente definido não pode ser trocado.",
      "Não é possível reativar automaticamente um contato com opt-out."
    ],
    "variants": [
      {
        "id": "edit",
        "label": "Alterar dados",
        "pathParams": {
          "id": "00000000-0000-4000-8000-000000000001"
        },
        "body": {
          "name": "Carlos Souza",
          "email": "carlos@example.com"
        }
      },
      {
        "id": "consent",
        "label": "Revogar consentimento",
        "pathParams": {
          "id": "00000000-0000-4000-8000-000000000001"
        },
        "body": {
          "consent": false
        }
      }
    ],
    "response": {
      "id": "00000000-0000-4000-8000-000000000001",
      "name": "Carlos Souza",
      "phone": "+5519999999999",
      "consent": false
    }
  },
  "POST /reminders": {
    "title": "Criar agendamento e lembretes",
    "description": "Cria ou atualiza contato, registro e compromisso em uma única chamada. Usa external_id para evitar agendamentos duplicados.",
    "scope": [
      "events:write",
      "contacts:write"
    ],
    "hints": [
      "O mesmo external_id atualiza o compromisso existente.",
      "É possível configurar até três lembretes.",
      "Datas devem ser futuras e no horário local informado."
    ],
    "variants": [
      {
        "id": "full",
        "label": "Revisão automotiva",
        "body": {
          "external_id": "REV-2026-1045",
          "contact": {
            "external_id": "cliente-102",
            "name": "Carlos Silva",
            "phone": "+5519999999999",
            "consent": true,
            "consent_source": "Agendamento solicitado pelo cliente"
          },
          "record": {
            "type": "vehicle",
            "external_id": "veiculo-ABC1D23",
            "label": "Corolla",
            "details": {
              "model": "Corolla",
              "plate": "ABC1D23"
            }
          },
          "event": {
            "title": "Revisão programada",
            "type": "revisao",
            "date": "2026-12-15",
            "time": "09:00",
            "timezone": "America/Sao_Paulo",
            "confirmation_enabled": true
          },
          "reminders": [
            {
              "before": 3,
              "unit": "days",
              "send_time": "09:00",
              "enabled": true
            },
            {
              "before": 1,
              "unit": "days",
              "send_time": "09:00",
              "enabled": true
            }
          ]
        },
        "description": "Contato, veículo, evento e lembretes"
      },
      {
        "id": "simple",
        "label": "Compromisso simples",
        "body": {
          "external_id": "CONSULTA-2026-18",
          "contact": {
            "name": "Mariana Lima",
            "phone": "+5519999999999",
            "consent": true,
            "consent_source": "Consulta agendada"
          },
          "event": {
            "title": "Consulta",
            "date": "2026-12-15",
            "time": "10:00"
          }
        },
        "description": "Sem veículo ou regras personalizadas"
      }
    ],
    "response": {
      "created": true,
      "external_id": "REV-2026-1045",
      "event_id": "00000000-0000-4000-8000-000000000002"
    }
  },
  "GET /events": {
    "title": "Listar agendamentos",
    "description": "Visualize os compromissos sincronizados pela API, com opção de filtro por situação.",
    "scope": [
      "events:read"
    ],
    "hints": [
      "Retorna somente eventos com external_id.",
      "Paginação de 20 registros."
    ],
    "variants": [
      {
        "id": "all",
        "label": "Todos",
        "query": "page=1"
      },
      {
        "id": "scheduled",
        "label": "Programados",
        "query": "status=scheduled&page=1"
      },
      {
        "id": "cancelled",
        "label": "Cancelados",
        "query": "status=cancelled&page=1"
      }
    ],
    "response": {
      "items": [
        {
          "external_id": "REV-2026-1045",
          "title": "Revisão",
          "status": "scheduled",
          "confirmation_enabled": true
        }
      ],
      "total": 1,
      "page": 1,
      "pages": 1
    }
  },
  "POST /events": {
    "title": "Registrar evento (alias)",
    "description": "Alternativa equivalente a POST /reminders para integração com CRMs que trabalham com eventos.",
    "scope": [
      "events:write",
      "contacts:write"
    ],
    "hints": [
      "O corpo é igual ao de POST /reminders.",
      "external_id mantém a operação idempotente."
    ],
    "variants": [
      {
        "id": "simple",
        "label": "Consulta",
        "body": {
          "external_id": "CONSULTA-2026-18",
          "contact": {
            "name": "Mariana Lima",
            "phone": "+5519999999999",
            "consent": true,
            "consent_source": "Consulta agendada"
          },
          "event": {
            "title": "Consulta",
            "date": "2026-12-15",
            "time": "10:00"
          }
        },
        "description": "Registrar consulta agendada"
      },
      {
        "id": "auto",
        "label": "Revisão",
        "body": {
          "external_id": "REV-2026-1045",
          "contact": {
            "external_id": "cliente-102",
            "name": "Carlos Silva",
            "phone": "+5519999999999",
            "consent": true,
            "consent_source": "Agendamento solicitado pelo cliente"
          },
          "record": {
            "type": "vehicle",
            "external_id": "veiculo-ABC1D23",
            "label": "Corolla",
            "details": {
              "model": "Corolla",
              "plate": "ABC1D23"
            }
          },
          "event": {
            "title": "Revisão programada",
            "type": "revisao",
            "date": "2026-12-15",
            "time": "09:00",
            "timezone": "America/Sao_Paulo",
            "confirmation_enabled": true
          },
          "reminders": [
            {
              "before": 3,
              "unit": "days",
              "send_time": "09:00",
              "enabled": true
            },
            {
              "before": 1,
              "unit": "days",
              "send_time": "09:00",
              "enabled": true
            }
          ]
        },
        "description": "Registrar revisão com lembretes"
      }
    ],
    "response": {
      "created": true,
      "external_id": "CONSULTA-2026-18"
    }
  },
  "GET /events/{externalId}": {
    "title": "Consultar um agendamento",
    "description": "Busque o compromisso pelo identificador externo e visualize status e confirmações.",
    "scope": [
      "events:read"
    ],
    "hints": [
      "Use exatamente o external_id utilizado no cadastro.",
      "O identificador fica no caminho da URL."
    ],
    "variants": [
      {
        "id": "one",
        "label": "Consultar evento",
        "pathParams": {
          "externalId": "REV-2026-1045"
        }
      }
    ],
    "response": {
      "external_id": "REV-2026-1045",
      "title": "Revisão programada",
      "status": "scheduled",
      "confirmation_status": "pending"
    }
  },
  "PATCH /events/{externalId}": {
    "title": "Reagendar ou editar",
    "description": "Atualize data, horário, título ou habilitação das confirmações de um evento existente.",
    "scope": [
      "events:write"
    ],
    "hints": [
      "Ao reagendar, os lembretes futuros são reconstruídos.",
      "Só envie os campos que deseja alterar."
    ],
    "variants": [
      {
        "id": "date",
        "label": "Nova data",
        "pathParams": {
          "externalId": "REV-2026-1045"
        },
        "body": {
          "date": "2026-12-18",
          "time": "11:00"
        }
      },
      {
        "id": "confirm",
        "label": "Habilitar confirmação",
        "pathParams": {
          "externalId": "REV-2026-1045"
        },
        "body": {
          "confirmation_enabled": true
        }
      }
    ],
    "response": {
      "external_id": "REV-2026-1045",
      "status": "scheduled"
    }
  },
  "POST /events/{externalId}/cancel": {
    "title": "Cancelar agendamento",
    "description": "Cancele um compromisso e impeça o envio de novos lembretes programados.",
    "scope": [
      "events:write"
    ],
    "hints": [
      "O cancelamento não desfaz mensagens já aceitas pela GoTo."
    ],
    "variants": [
      {
        "id": "cancel",
        "label": "Cancelar",
        "pathParams": {
          "externalId": "REV-2026-1045"
        }
      }
    ],
    "response": {
      "external_id": "REV-2026-1045",
      "status": "cancelled"
    }
  },
  "GET /reminders/{externalId}": {
    "title": "Consultar lembretes",
    "description": "Consulte um compromisso e os estados das mensagens associadas ao seu external_id.",
    "scope": [
      "events:read"
    ],
    "hints": [
      "Esta rota é uma alternativa de consulta ao endpoint de eventos."
    ],
    "variants": [
      {
        "id": "one",
        "label": "Por external_id",
        "pathParams": {
          "externalId": "REV-2026-1045"
        }
      }
    ],
    "response": {
      "external_id": "REV-2026-1045",
      "status": "scheduled",
      "reminders": []
    }
  },
  "POST /imports": {
    "title": "Importar agendamentos em lote",
    "description": "Envie até 50 compromissos por requisição e receba o resultado por item.",
    "scope": [
      "imports:write",
      "events:write",
      "contacts:write"
    ],
    "hints": [
      "A resposta utiliza HTTP 207 e pode conter sucesso parcial.",
      "Cada item precisa seguir o mesmo formato de POST /reminders."
    ],
    "variants": [
      {
        "id": "batch",
        "label": "Dois compromissos",
        "body": {
          "items": [
            {
              "external_id": "CONSULTA-2026-18",
              "contact": {
                "name": "Mariana Lima",
                "phone": "+5519999999999",
                "consent": true,
                "consent_source": "Consulta agendada"
              },
              "event": {
                "title": "Consulta",
                "date": "2026-12-15",
                "time": "10:00"
              }
            },
            {
              "external_id": "CONSULTA-2026-19",
              "contact": {
                "name": "João Dias",
                "phone": "+5519888887777",
                "consent": true,
                "consent_source": "Agendamento no CRM"
              },
              "event": {
                "title": "Consulta",
                "date": "2026-12-15",
                "time": "10:00"
              }
            }
          ]
        },
        "description": "Importação pequena"
      },
      {
        "id": "one",
        "label": "Um item",
        "body": {
          "items": [
            {
              "external_id": "CONSULTA-2026-18",
              "contact": {
                "name": "Mariana Lima",
                "phone": "+5519999999999",
                "consent": true,
                "consent_source": "Consulta agendada"
              },
              "event": {
                "title": "Consulta",
                "date": "2026-12-15",
                "time": "10:00"
              }
            }
          ]
        },
        "description": "Verificar o fluxo antes de lotes maiores"
      }
    ],
    "response": {
      "job_id": "00000000-0000-4000-8000-000000000003",
      "total": 2,
      "imported": 2,
      "rejected": 0,
      "items": [],
      "errors": []
    }
  },
  "GET /imports/{id}": {
    "title": "Consultar importação",
    "description": "Visualize quantidade de registros importados, rejeitados e o motivo das falhas.",
    "scope": [
      "events:read"
    ],
    "hints": [
      "O ID é retornado no resultado de POST /imports."
    ],
    "variants": [
      {
        "id": "status",
        "label": "Resultado",
        "pathParams": {
          "id": "00000000-0000-4000-8000-000000000003"
        }
      }
    ],
    "response": {
      "id": "00000000-0000-4000-8000-000000000003",
      "imported": 2,
      "rejected": 0,
      "errors": []
    }
  },
  "POST /messages/send": {
    "title": "Disparar WhatsApp pela URA",
    "description": "Enfileire um template aprovado na GoTo a partir de uma URA, CRM ou aplicativo. Não exige Call ID nem agendamento.",
    "scope": [
      "messages:send"
    ],
    "hints": [
      "A resposta HTTP 202 confirma fila, não entrega.",
      "O cliente deve ter escolhido receber a mensagem; não basta capturar o Caller ID.",
      "Pedidos idênticos em até 120 segundos retornam o mesmo request_id.",
      "Até 10 solicitações por hora para o mesmo número e ambiente.",
      "Variáveis e mídia dependem da estrutura aprovada do template."
    ],
    "variants": [
      {
        "id": "basic",
        "label": "Envio simples",
        "body": {
          "to": "+5519999999999",
          "template": "continuar_atendimento_whatsapp",
          "consent": {
            "confirmed": true,
            "source": "ivr_option_whatsapp"
          }
        },
        "description": "Template sem variáveis"
      },
      {
        "id": "params",
        "label": "Com variáveis",
        "body": {
          "to": "+5519999999999",
          "template": "continuar_atendimento_whatsapp",
          "language": "pt_BR",
          "variables": {
            "body.parameter_0": "Suporte técnico"
          },
          "consent": {
            "confirmed": true,
            "source": "ivr_option_whatsapp"
          }
        },
        "description": "Personalizar texto do template"
      },
      {
        "id": "buttons",
        "label": "Botão com URL",
        "body": {
          "to": "+5519999999999",
          "template": "continuar_atendimento_whatsapp",
          "variables": {
            "body.parameter_0": "Atendimento",
            "buttons.0.parameter_0": "acesso-123"
          },
          "consent": {
            "confirmed": true,
            "source": "ivr_option_whatsapp"
          }
        },
        "description": "Parâmetro de URL previamente configurado"
      },
      {
        "id": "media",
        "label": "Cabeçalho com mídia",
        "body": {
          "to": "+5519999999999",
          "template": "instrucoes_atendimento",
          "media_asset_id": "00000000-0000-4000-8000-000000000004",
          "consent": {
            "confirmed": true,
            "source": "explicit_customer_request"
          }
        },
        "description": "Mídia privada do ambiente"
      }
    ],
    "response": {
      "success": true,
      "request_id": "00000000-0000-4000-8000-000000000005",
      "status": "queued",
      "deduplicated": false,
      "notice": "Pedido aceito para processamento, não confirmação de entrega"
    }
  },
  "GET /messages/send/{id}": {
    "title": "Consultar disparo imediato",
    "description": "Acompanhe o resultado de uma solicitação criada por POST /messages/send.",
    "scope": [
      "messages:send"
    ],
    "hints": [
      "Use request_id retornado no HTTP 202.",
      "sent significa aceito pela GoTo; delivered depende do webhook de entrega."
    ],
    "variants": [
      {
        "id": "status",
        "label": "Por request_id",
        "pathParams": {
          "id": "00000000-0000-4000-8000-000000000005"
        }
      }
    ],
    "response": {
      "id": "00000000-0000-4000-8000-000000000005",
      "status": "sent",
      "sent_at": "2026-12-15T12:00:00Z",
      "error_code": null
    }
  },
  "GET /messages": {
    "title": "Consultar histórico de lembretes",
    "description": "Liste os status de disparos de lembretes, opcionalmente por identificador externo do agendamento.",
    "scope": [
      "messages:read"
    ],
    "hints": [
      "Esta rota lista lembretes de agendamento, não pedidos avulsos da URA.",
      "Para um disparo da URA utilize GET /messages/send/{id}."
    ],
    "variants": [
      {
        "id": "all",
        "label": "Todos os lembretes",
        "query": "page=1"
      },
      {
        "id": "event",
        "label": "Por agendamento",
        "query": "external_id=REV-2026-1045&page=1"
      }
    ],
    "response": {
      "items": [
        {
          "status": "sent",
          "external_id": "REV-2026-1045",
          "slot": 1
        }
      ],
      "total": 1,
      "page": 1,
      "pages": 1
    }
  }
};

export const docsGroups=[
 {id:'Disparos',label:'Mensagens WhatsApp'},
 {id:'Contatos',label:'Contatos'},
 {id:'Agendamentos',label:'Agendamentos'},
 {id:'Importações',label:'Importações'}
] as const;
export type ApiOperation={id:string;method:string;path:string;summary:string;description:string;group:string;scopes:string[];variants:DocsVariant[];response?:unknown;hints:string[]};
export function collectOperations(spec:any):ApiOperation[]{
 const order=['get','post','patch','put','delete'];
 const out:ApiOperation[]=[];
 for(const [path,value] of Object.entries(spec.paths||{}) as [string,any][]){
  for(const method of order){
   const op=value?.[method];if(!op)continue;
   const id=method.toUpperCase()+' '+path;
   const meta=endpointDocs[id];
   out.push({
    id,method:method.toUpperCase(),path,
    summary:meta?.title||op.summary||path,
    description:meta?.description||op.description||'Consulte os parâmetros e respostas deste endpoint.',
    group:(op.tags||[])[0]||'Outros',
    scopes:meta?.scope||[],
    variants:meta?.variants?.length?meta.variants:[{id:'default',label:'Exemplo'}],
    response:meta?.response,
    hints:meta?.hints||[]
   });
  }
 }
 return out;
}
export function examplePath(path:string,params:Record<string,string>={}){
 return path.replace(/\{([^}]+)\}/g,(_,id)=>encodeURIComponent(params[id]||('SEU_'+id.toUpperCase())));
}
export function generatedRequest(args:{base:string;token:string;method:string;path:string;variant:DocsVariant;language:'curl'|'python'|'node'}){
 const {base,token,method,path,variant,language}=args;
 const endpoint=base.replace(/\/+$/,'')+'/v1'+examplePath(path,variant.pathParams||{})+(variant.query?'?'+variant.query:'');
 const json=variant.body===undefined?null:JSON.stringify(variant.body,null,2);
 if(language==='curl'){
  const cmd=['curl -i -X '+method,'  '+JSON.stringify(endpoint),'  -H '+JSON.stringify('Authorization: Bearer '+token)];
  if(json!==null){
   cmd.push('  -H '+JSON.stringify('Content-Type: application/json'));
   cmd.push("  --data-raw '"+json.replace(/'/g, "'\\''")+"'");
  }
  return cmd.map((v,i)=>v+(i<cmd.length-1?' \\':'')).join('\n');
 }
 if(language==='python')return [
  'import requests',
  '',
  'url = '+JSON.stringify(endpoint),
  'headers = {"Authorization": "Bearer '+token+'"}',
  ...(json!==null?['payload = '+json.replace(/\btrue\b/g,'True').replace(/\bfalse\b/g,'False').replace(/\bnull\b/g,'None')]:[]),
  '',
  'response = requests.request('+JSON.stringify(method)+', url, headers=headers'+(json!==null?', json=payload':'')+', timeout=20)',
  'print(response.status_code)',
  'print(response.text)'
 ].join('\n');
 return [
  '// Node.js 22+ — fetch nativo',
  'const response = await fetch('+JSON.stringify(endpoint)+', {',
  '  method: '+JSON.stringify(method)+',',
  '  headers: {',
  '    Authorization: '+JSON.stringify('Bearer '+token)+','+(json!==null?"\n    'Content-Type': 'application/json',":''),
  '  },',
  ...(json!==null?['  body: JSON.stringify('+json+'),']:[]),
  '});',
  'console.log(response.status, await response.text());'
 ].join('\n');
}
