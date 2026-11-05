import {templateFields} from './goto-template.js';
export type Segment='automotive'|'clinic'|'pet'|'custom';
export type CatalogVariable={part:'body'|'header'|'button';position:number;buttonIndex?:number;label:string;example:string;selector:string;manual?:boolean};
export type CatalogButton={type:'QUICK_REPLY'|'URL';text:string;url?:string};
export type CatalogPreset={id:string;segment:Segment;title:string;description:string;name:string;languageCode:'pt_BR';suggestedCategory:'UTILITY';suggestedOffsetDays:1|3|30;header?:{type:'TEXT'|'IMAGE'|'VIDEO'|'DOCUMENT';text?:string};body:string;footer?:string;buttons:CatalogButton[];variables:CatalogVariable[];guidance:string};
/** Referências para cadastro MANUAL na Meta. Não são templates aprovados. */
export const TEMPLATE_LIBRARY:readonly CatalogPreset[]=[
  {
    "id": "auto_revisao_30d",
    "segment": "automotive",
    "name": "brnotify_auto_revisao_agendada",
    "title": "Revisão agendada",
    "description": "Aviso inicial de revisão.",
    "languageCode": "pt_BR",
    "suggestedCategory": "UTILITY",
    "suggestedOffsetDays": 30,
    "body": "Olá, {{1}}! Sua revisão do veículo {{2}}, placa {{3}}, está agendada para {{4}} às {{5}}. Em caso de dúvidas, fale com a concessionária.",
    "footer": "Mensagem automática relacionada ao seu agendamento.",
    "buttons": [],
    "variables": [
      {
        "part": "body",
        "position": 1,
        "label": "Nome",
        "example": "Carlos",
        "selector": "contact.name"
      },
      {
        "part": "body",
        "position": 2,
        "label": "Modelo",
        "example": "Corolla",
        "selector": "record.model"
      },
      {
        "part": "body",
        "position": 3,
        "label": "Placa",
        "example": "ABC1D23",
        "selector": "record.plate"
      },
      {
        "part": "body",
        "position": 4,
        "label": "Data",
        "example": "15/12/2026",
        "selector": "event.date"
      },
      {
        "part": "body",
        "position": 5,
        "label": "Horário",
        "example": "09:00",
        "selector": "event.time"
      }
    ],
    "guidance": "Utilize somente para um compromisso já marcado e contatos com autorização para receber mensagens."
  },
  {
    "id": "auto_revisao_3d",
    "segment": "automotive",
    "name": "brnotify_auto_confirmar_revisao",
    "title": "Confirmação de revisão",
    "description": "Imagem e confirmação por resposta rápida.",
    "languageCode": "pt_BR",
    "suggestedCategory": "UTILITY",
    "suggestedOffsetDays": 3,
    "body": "Olá, {{1}}. A revisão do seu {{2}} está marcada para {{3}} às {{4}}. Você poderá comparecer?",
    "footer": "Mensagem automática relacionada ao seu agendamento.",
    "buttons": [
      {
        "type": "QUICK_REPLY",
        "text": "Confirmar"
      },
      {
        "type": "QUICK_REPLY",
        "text": "Reagendar"
      }
    ],
    "variables": [
      {
        "part": "body",
        "position": 1,
        "label": "Nome",
        "example": "Carlos",
        "selector": "contact.name"
      },
      {
        "part": "body",
        "position": 2,
        "label": "Modelo",
        "example": "Corolla",
        "selector": "record.model"
      },
      {
        "part": "body",
        "position": 3,
        "label": "Data",
        "example": "15/12/2026",
        "selector": "event.date"
      },
      {
        "part": "body",
        "position": 4,
        "label": "Horário",
        "example": "09:00",
        "selector": "event.time"
      }
    ],
    "guidance": "A resposta dos botões só deve atualizar o agendamento após homologação dos eventos da GoTo.",
    "header": {
      "type": "IMAGE"
    }
  },
  {
    "id": "auto_retirada_1d",
    "segment": "automotive",
    "name": "brnotify_auto_retirada",
    "title": "Retirada de veículo",
    "description": "Aviso de retirada com link dinâmico.",
    "languageCode": "pt_BR",
    "suggestedCategory": "UTILITY",
    "suggestedOffsetDays": 1,
    "body": "Olá, {{1}}. A retirada do veículo {{2}}, placa {{3}}, está prevista para {{4}} às {{5}}. Veja os detalhes no botão abaixo.",
    "footer": "Mensagem automática relacionada ao seu agendamento.",
    "buttons": [
      {
        "type": "URL",
        "text": "Ver agendamento",
        "url": "https://seu-dominio.com/agendamento/{{1}}"
      }
    ],
    "variables": [
      {
        "part": "body",
        "position": 1,
        "label": "Nome",
        "example": "Carlos",
        "selector": "contact.name"
      },
      {
        "part": "body",
        "position": 2,
        "label": "Modelo",
        "example": "Corolla",
        "selector": "record.model"
      },
      {
        "part": "body",
        "position": 3,
        "label": "Placa",
        "example": "ABC1D23",
        "selector": "record.plate"
      },
      {
        "part": "body",
        "position": 4,
        "label": "Data",
        "example": "15/12/2026",
        "selector": "event.date"
      },
      {
        "part": "body",
        "position": 5,
        "label": "Horário",
        "example": "09:00",
        "selector": "event.time"
      },
      {
        "part": "button",
        "position": 1,
        "buttonIndex": 0,
        "label": "Código do link",
        "example": "REV123",
        "selector": "event.custom.url_suffix",
        "manual": true
      }
    ],
    "guidance": "Substitua seu-dominio.com por seu domínio HTTPS. O sufixo dinâmico deve estar preenchido no evento."
  },
  {
    "id": "clinica_consulta_30d",
    "segment": "clinic",
    "name": "brnotify_clinica_consulta",
    "title": "Consulta agendada",
    "description": "Lembrete de consulta previamente marcada.",
    "languageCode": "pt_BR",
    "suggestedCategory": "UTILITY",
    "suggestedOffsetDays": 30,
    "body": "Olá, {{1}}. Sua consulta está agendada para {{2}} às {{3}}, na unidade {{4}}. Para orientações, entre em contato com a recepção.",
    "footer": "Mensagem automática relacionada ao seu agendamento.",
    "buttons": [],
    "variables": [
      {
        "part": "body",
        "position": 1,
        "label": "Paciente",
        "example": "Mariana",
        "selector": "contact.name"
      },
      {
        "part": "body",
        "position": 2,
        "label": "Data",
        "example": "15/12/2026",
        "selector": "event.date"
      },
      {
        "part": "body",
        "position": 3,
        "label": "Horário",
        "example": "09:00",
        "selector": "event.time"
      },
      {
        "part": "body",
        "position": 4,
        "label": "Unidade",
        "example": "Centro",
        "selector": "record.unit"
      }
    ],
    "guidance": "Não inclua diagnósticos ou dados de saúde sensíveis."
  },
  {
    "id": "clinica_exame_3d",
    "segment": "clinic",
    "name": "brnotify_clinica_orientacoes_exame",
    "title": "Orientações de exame",
    "description": "PDF com orientações de preparo.",
    "languageCode": "pt_BR",
    "suggestedCategory": "UTILITY",
    "suggestedOffsetDays": 3,
    "body": "Olá, {{1}}. Seu exame está agendado para {{2}} às {{3}}. Consulte o documento anexado para orientações gerais.",
    "footer": "Mensagem automática relacionada ao seu agendamento.",
    "buttons": [],
    "variables": [
      {
        "part": "body",
        "position": 1,
        "label": "Nome",
        "example": "Carlos",
        "selector": "contact.name"
      },
      {
        "part": "body",
        "position": 2,
        "label": "Data",
        "example": "15/12/2026",
        "selector": "event.date"
      },
      {
        "part": "body",
        "position": 3,
        "label": "Horário",
        "example": "09:00",
        "selector": "event.time"
      }
    ],
    "guidance": "Use PDF autorizado pela clínica e não exponha informações clínicas sensíveis.",
    "header": {
      "type": "DOCUMENT"
    }
  },
  {
    "id": "clinica_retorno_1d",
    "segment": "clinic",
    "name": "brnotify_clinica_retorno",
    "title": "Confirmação de retorno",
    "description": "Retorno com botões de confirmação.",
    "languageCode": "pt_BR",
    "suggestedCategory": "UTILITY",
    "suggestedOffsetDays": 1,
    "body": "Olá, {{1}}. Seu retorno está marcado para {{2}} às {{3}}. Confirme sua presença ou solicite uma nova data.",
    "footer": "Mensagem automática relacionada ao seu agendamento.",
    "buttons": [
      {
        "type": "QUICK_REPLY",
        "text": "Confirmar"
      },
      {
        "type": "QUICK_REPLY",
        "text": "Reagendar"
      }
    ],
    "variables": [
      {
        "part": "body",
        "position": 1,
        "label": "Nome",
        "example": "Carlos",
        "selector": "contact.name"
      },
      {
        "part": "body",
        "position": 2,
        "label": "Data",
        "example": "15/12/2026",
        "selector": "event.date"
      },
      {
        "part": "body",
        "position": 3,
        "label": "Horário",
        "example": "09:00",
        "selector": "event.time"
      }
    ],
    "guidance": "Confirme o formato de resposta da GoTo antes de automatizar a decisão."
  },
  {
    "id": "pet_banho_30d",
    "segment": "pet",
    "name": "brnotify_pet_banho_tosa",
    "title": "Banho e tosa agendados",
    "description": "Primeiro lembrete do serviço de banho e tosa.",
    "languageCode": "pt_BR",
    "suggestedCategory": "UTILITY",
    "suggestedOffsetDays": 30,
    "body": "Olá, {{1}}. O banho e tosa de {{2}} estão marcados para {{3}} às {{4}}. Se precisar alterar o horário, fale com a equipe.",
    "footer": "Mensagem automática relacionada ao seu agendamento.",
    "buttons": [],
    "variables": [
      {
        "part": "body",
        "position": 1,
        "label": "Nome",
        "example": "Carlos",
        "selector": "contact.name"
      },
      {
        "part": "body",
        "position": 2,
        "label": "Pet",
        "example": "Luna",
        "selector": "record.pet_name"
      },
      {
        "part": "body",
        "position": 3,
        "label": "Data",
        "example": "15/12/2026",
        "selector": "event.date"
      },
      {
        "part": "body",
        "position": 4,
        "label": "Horário",
        "example": "09:00",
        "selector": "event.time"
      }
    ],
    "guidance": "Utilize somente para um compromisso já marcado e contatos com autorização para receber mensagens."
  },
  {
    "id": "pet_vet_3d",
    "segment": "pet",
    "name": "brnotify_pet_consulta_veterinaria",
    "title": "Consulta veterinária",
    "description": "Lembrete com imagem e botões.",
    "languageCode": "pt_BR",
    "suggestedCategory": "UTILITY",
    "suggestedOffsetDays": 3,
    "body": "Olá, {{1}}. A consulta de {{2}} está agendada para {{3}} às {{4}}. Podemos contar com vocês?",
    "footer": "Mensagem automática relacionada ao seu agendamento.",
    "buttons": [
      {
        "type": "QUICK_REPLY",
        "text": "Confirmar"
      },
      {
        "type": "QUICK_REPLY",
        "text": "Reagendar"
      }
    ],
    "variables": [
      {
        "part": "body",
        "position": 1,
        "label": "Nome",
        "example": "Carlos",
        "selector": "contact.name"
      },
      {
        "part": "body",
        "position": 2,
        "label": "Pet",
        "example": "Luna",
        "selector": "record.pet_name"
      },
      {
        "part": "body",
        "position": 3,
        "label": "Data",
        "example": "15/12/2026",
        "selector": "event.date"
      },
      {
        "part": "body",
        "position": 4,
        "label": "Horário",
        "example": "09:00",
        "selector": "event.time"
      }
    ],
    "guidance": "Utilize somente para um compromisso já marcado e contatos com autorização para receber mensagens.",
    "header": {
      "type": "IMAGE"
    }
  },
  {
    "id": "pet_retorno_1d",
    "segment": "pet",
    "name": "brnotify_pet_retorno",
    "title": "Retorno do pet",
    "description": "Lembrete final de retorno.",
    "languageCode": "pt_BR",
    "suggestedCategory": "UTILITY",
    "suggestedOffsetDays": 1,
    "body": "Olá, {{1}}. Lembramos do retorno de {{2}} em {{3}} às {{4}}. Em caso de imprevistos, entre em contato.",
    "footer": "Mensagem automática relacionada ao seu agendamento.",
    "buttons": [],
    "variables": [
      {
        "part": "body",
        "position": 1,
        "label": "Nome",
        "example": "Carlos",
        "selector": "contact.name"
      },
      {
        "part": "body",
        "position": 2,
        "label": "Pet",
        "example": "Luna",
        "selector": "record.pet_name"
      },
      {
        "part": "body",
        "position": 3,
        "label": "Data",
        "example": "15/12/2026",
        "selector": "event.date"
      },
      {
        "part": "body",
        "position": 4,
        "label": "Horário",
        "example": "09:00",
        "selector": "event.time"
      }
    ],
    "guidance": "Utilize somente para um compromisso já marcado e contatos com autorização para receber mensagens."
  },
  {
    "id": "geral_lembrete_30d",
    "segment": "custom",
    "name": "brnotify_geral_lembrete",
    "title": "Lembrete de compromisso",
    "description": "Lembrete de qualquer atividade agendada.",
    "languageCode": "pt_BR",
    "suggestedCategory": "UTILITY",
    "suggestedOffsetDays": 30,
    "body": "Olá, {{1}}. Lembramos do compromisso {{2}} programado para {{3}} às {{4}}. Caso precise de ajuda, fale com o estabelecimento.",
    "footer": "Mensagem automática relacionada ao seu agendamento.",
    "buttons": [],
    "variables": [
      {
        "part": "body",
        "position": 1,
        "label": "Nome",
        "example": "Carlos",
        "selector": "contact.name"
      },
      {
        "part": "body",
        "position": 2,
        "label": "Compromisso",
        "example": "Atendimento",
        "selector": "event.title"
      },
      {
        "part": "body",
        "position": 3,
        "label": "Data",
        "example": "15/12/2026",
        "selector": "event.date"
      },
      {
        "part": "body",
        "position": 4,
        "label": "Horário",
        "example": "09:00",
        "selector": "event.time"
      }
    ],
    "guidance": "Utilize somente para um compromisso já marcado e contatos com autorização para receber mensagens."
  },
  {
    "id": "geral_confirmar_3d",
    "segment": "custom",
    "name": "brnotify_geral_confirmacao",
    "title": "Confirmar presença",
    "description": "Cabeçalho dinâmico e respostas rápidas.",
    "languageCode": "pt_BR",
    "suggestedCategory": "UTILITY",
    "suggestedOffsetDays": 3,
    "body": "Olá, {{1}}. Seu compromisso está marcado para {{2}} às {{3}}. Confirme sua presença ou solicite reagendamento.",
    "footer": "Mensagem automática relacionada ao seu agendamento.",
    "buttons": [
      {
        "type": "QUICK_REPLY",
        "text": "Confirmar"
      },
      {
        "type": "QUICK_REPLY",
        "text": "Reagendar"
      }
    ],
    "variables": [
      {
        "part": "header",
        "position": 1,
        "label": "Compromisso",
        "example": "Atendimento",
        "selector": "event.title"
      },
      {
        "part": "body",
        "position": 1,
        "label": "Nome",
        "example": "Carlos",
        "selector": "contact.name"
      },
      {
        "part": "body",
        "position": 2,
        "label": "Data",
        "example": "15/12/2026",
        "selector": "event.date"
      },
      {
        "part": "body",
        "position": 3,
        "label": "Horário",
        "example": "09:00",
        "selector": "event.time"
      }
    ],
    "guidance": "Utilize somente para um compromisso já marcado e contatos com autorização para receber mensagens.",
    "header": {
      "type": "TEXT",
      "text": "Lembrete de {{1}}"
    }
  },
  {
    "id": "geral_documento_1d",
    "segment": "custom",
    "name": "brnotify_geral_orientacoes",
    "title": "Instruções do compromisso",
    "description": "Lembrete final com PDF.",
    "languageCode": "pt_BR",
    "suggestedCategory": "UTILITY",
    "suggestedOffsetDays": 1,
    "body": "Olá, {{1}}. Seu compromisso {{2}} será em {{3}} às {{4}}. Consulte as orientações no documento anexado.",
    "footer": "Mensagem automática relacionada ao seu agendamento.",
    "buttons": [],
    "variables": [
      {
        "part": "body",
        "position": 1,
        "label": "Nome",
        "example": "Carlos",
        "selector": "contact.name"
      },
      {
        "part": "body",
        "position": 2,
        "label": "Compromisso",
        "example": "Atendimento",
        "selector": "event.title"
      },
      {
        "part": "body",
        "position": 3,
        "label": "Data",
        "example": "15/12/2026",
        "selector": "event.date"
      },
      {
        "part": "body",
        "position": 4,
        "label": "Horário",
        "example": "09:00",
        "selector": "event.time"
      }
    ],
    "guidance": "Utilize somente para um compromisso já marcado e contatos com autorização para receber mensagens.",
    "header": {
      "type": "DOCUMENT"
    }
  }
];
export function findPreset(id:string){return TEMPLATE_LIBRARY.find(p=>p.id===id)||null;}
export type MappingSuggestion={compatible:boolean;issues:string[];suggested:Record<string,string>;requiredMedia:boolean;manualFields:string[]};
export function mergePresetMapping(suggested:Record<string,string>,current:Record<string,string>,overwrite=false){
 return overwrite?{...current,...suggested}:{...suggested,...current};
}
function normalizedTemplateText(value:unknown){
 return String(value??'').replace(/\{\{[^}]+\}\}/g,'{{}}').replace(/\s+/g,' ').trim().toLocaleLowerCase('pt-BR');
}
export function suggestMapping(preset:CatalogPreset,definition:Record<string,any>):MappingSuggestion{
 const issues:string[]=[],suggested:Record<string,string>={};
 const fields=templateFields(definition);
 const section=(type:string)=>(definition?.components||[]).find((s:any)=>s.type===type);
 const media=fields.filter(f=>f.key==='header.media');
 const hasMedia=!!(preset.header&&preset.header.type!=='TEXT');
 if(hasMedia){
  const expected=preset.header!.type.toLowerCase();
  const head=(section('header')?.components||[]).find((x:any)=>['image','video','document'].includes(x.type));
  if(media.length!==1||head?.type!==expected)issues.push('Tipo de mídia do cabeçalho diferente');
 }else if(media.length)issues.push('Este modelo não prevê mídia');
 if(!preset.header&&section('header'))issues.push('Cabeçalho inesperado');
 if(fields.some(f=>f.key.startsWith('footer.')))issues.push('Parâmetros extras no rodapé');
 const expectedHeader=preset.variables.filter(v=>v.part==='header');
 const gotHeader=fields.filter(f=>f.key.startsWith('header.')&&f.kind==='text');
 if(expectedHeader.length!==gotHeader.length)issues.push('Variáveis do cabeçalho diferentes');
 const expectedBody=preset.variables.filter(v=>v.part==='body');
 const gotBody=fields.filter(f=>f.key.startsWith('body.')&&f.kind==='text');
 if(expectedBody.length!==gotBody.length)issues.push('Variáveis do corpo diferentes');
 const bodyText=(section('body')?.components||[]).find((item:any)=>item.type==='text')?.attributes?.text;
 if(normalizedTemplateText(bodyText)!==normalizedTemplateText(preset.body))
  issues.push('Texto do corpo diferente do modelo');
 if(preset.header?.type==='TEXT'){
  const text=(section('header')?.components||[]).find((item:any)=>item.type==='text')?.attributes?.text;
  if(normalizedTemplateText(text)!==normalizedTemplateText(preset.header.text))
   issues.push('Texto do cabeçalho diferente do modelo');
 }
 const btn=(section('buttons')?.components||[]) as Array<Record<string,any>>;
 if(btn.length!==preset.buttons.length)issues.push('Quantidade de botões diferente');
 for(const [index,wanted] of preset.buttons.entries()){
  if(!btn[index]||String(btn[index].attributes?.buttonType||'').toUpperCase()!==wanted.type)
   issues.push('Tipo do botão '+(index+1)+' diferente');
  if(btn[index]?.attributes?.text&&String(btn[index].attributes.text).trim()!==wanted.text)
   issues.push('Texto do botão '+(index+1)+' diferente');
  const expected=preset.variables.filter(v=>v.part==='button'&&v.buttonIndex===index);
  const actual=fields.filter(f=>f.key.startsWith('buttons.'+index+'.'));
  if(expected.length!==actual.length)issues.push('Parâmetros do botão '+(index+1)+' diferentes');
  if(expected.length===actual.length)actual.forEach((field,i)=>suggested[field.key]=expected[i].selector);
 }
 if(expectedHeader.length===gotHeader.length)gotHeader.forEach((field,i)=>suggested[field.key]=expectedHeader[i].selector);
 if(expectedBody.length===gotBody.length)gotBody.forEach((field,i)=>suggested[field.key]=expectedBody[i].selector);
 return {compatible:issues.length===0,issues,suggested,requiredMedia:hasMedia,
  manualFields:preset.variables.filter(v=>v.manual).map(v=>v.label)};
}
