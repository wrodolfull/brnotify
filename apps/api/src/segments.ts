export const segments={
  automotive:{label:'Automotivo',icon:'car',recordLabel:'Veículo',fields:[['brand','Marca'],['model','Modelo'],['plate','Placa'],['year','Ano'],['mileage','Quilometragem']],events:['Revisão','Troca de óleo','Seguro','Garantia']},
  clinic:{label:'Clínica',icon:'heart',recordLabel:'Atendimento',fields:[['professional','Profissional'],['unit','Unidade'],['procedure','Procedimento']],events:['Consulta','Retorno','Exame']},
  pet:{label:'Pet shop',icon:'paw',recordLabel:'Pet',fields:[['pet_name','Nome do pet'],['species','Espécie'],['breed','Raça']],events:['Banho','Tosa','Vacinação','Retorno']},
  custom:{label:'Personalizado',icon:'layers',recordLabel:'Registro',fields:[['description','Descrição']],events:['Lembrete']}
} as const;
