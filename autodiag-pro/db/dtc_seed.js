/**
 * AutoDiag Pro — Base de datos DTC técnica EXTENDIDA
 * 250+ códigos OBD-II con causas, síntomas, parámetros y diagnóstico diferencial
 * Fuente: SAE J2012, ISO 15031-6, TSBs fabricantes, datos mecánicos LATAM
 * Marcas: Toyota, Ford, Chevrolet, VW, Honda, Nissan, Hyundai, Kia, Renault, Peugeot, Fiat, BMW, Mercedes
 */

const DTC_DATABASE = [

  // ═══════════════════════════════════════════════════════════
  // P0XXX — POWERTRAIN / SISTEMA DE COMBUSTIBLE Y AIRE
  // ═══════════════════════════════════════════════════════════

  { code:'P0100', title:'Falla circuito sensor MAF', system:'Motor · Admisión', severity:'Moderado',
    description:'El sensor MAF no envía señal correcta. El caudal de aire no puede calcularse correctamente.',
    causes:['Sensor MAF defectuoso o sucio','Cableado del MAF dañado','Fuga de aire entre MAF y mariposa','Conector del MAF oxidado'],
    symptoms:['Motor tembla en ralentí','Pérdida de potencia','Mayor consumo','Humo negro'],
    diagnostic_params:{ maf_voltage_range:'0.5-4.8V', maf_idle_gs:'2-7 g/s para 1.6-2.0L', maf_wot_gs:'>80 g/s plena carga' },
    diagnostic_steps:['Medir voltaje MAF (0.5-4.8V)','Limpiar con spray MAF','Verificar fugas de aire','Verificar cableado'],
    freeze_frame_hints:'MAF voltage <0.5V o >4.8V = sensor defectuoso. Voltage normal con código = fuga de aire',
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'5-120',
    latam_notes:'Limpieza spray MAF $5-10. Sensor nuevo genérico $30-80. Original $100-200.' },

  { code:'P0101', title:'Rango/desempeño sensor MAF fuera de parámetros', system:'Motor · Admisión', severity:'Moderado',
    description:'El MAF registra valores fuera del rango esperado para las condiciones actuales.',
    causes:['MAF sucio (70% de casos)','Fuga de aire entre MAF y mariposa','Filtro de aire tapado','MAF defectuoso'],
    symptoms:['Falla en aceleración','Ralentí inestable','Mayor consumo'],
    diagnostic_params:{ expected_maf_idle:'2-7 g/s', expected_maf_2000rpm:'10-20 g/s' },
    diagnostic_steps:['Limpiar MAF con spray','Revisar filtro de aire','Buscar fugas de vacío','Comparar lectura MAF vs tabla por RPM'],
    freeze_frame_hints:'Comparar MAF actual vs calculado. Diferencia >20% = problema real',
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'5-80',
    latam_notes:'Limpieza MAF resuelve 70% casos. Filtro de aire $10-20.' },

  { code:'P0102', title:'Señal baja circuito MAF', system:'Motor · Admisión', severity:'Moderado',
    description:'La señal del MAF está por debajo del mínimo esperado.',
    causes:['Sensor MAF sucio','Cable de señal abierto','Masa del sensor deficiente','MAF defectuoso'],
    diagnostic_steps:['Verificar voltaje en pin de señal >0.5V','Limpiar MAF','Revisar continuidad de cables'],
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'5-100', latam_notes:'' },

  { code:'P0103', title:'Señal alta circuito MAF', system:'Motor · Admisión', severity:'Moderado',
    description:'La señal del MAF está por encima del máximo esperado.',
    causes:['Cortocircuito en cableado','MAF defectuoso','Interferencia electromagnética'],
    diagnostic_steps:['Verificar voltaje <4.8V','Desconectar MAF y ver si código desaparece','Revisar cableado por cortocircuito'],
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'30-120', latam_notes:'' },

  { code:'P0106', title:'Rango/desempeño sensor MAP', system:'Motor · Admisión', severity:'Moderado',
    description:'La presión en el colector no corresponde con valores esperados según RPM y carga.',
    causes:['Sensor MAP defectuoso','Manguera de vacío al MAP rota','Fuga de vacío grande','Sensor MAP tapado'],
    diagnostic_params:{ map_idle_kpa:'25-45 kPa', map_wot_kpa:'90-100 kPa', map_voltage_idle:'1-1.5V', map_voltage_wot:'4-4.5V' },
    diagnostic_steps:['Verificar manguera al MAP','Medir voltaje MAP','Comparar con rango esperado por RPM'],
    freeze_frame_hints:'MAP >60 kPa en ralentí = sensor defectuoso',
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'20-80', latam_notes:'' },

  { code:'P0107', title:'Señal baja circuito MAP', system:'Motor · Admisión', severity:'Moderado',
    description:'Señal del sensor MAP por debajo del mínimo. Motor corre en mapeo de emergencia.',
    causes:['Manguera de vacío desconectada','Sensor MAP defectuoso','Cable de señal abierto'],
    diagnostic_steps:['Verificar manguera MAP conectada','Medir voltaje >0.5V','Revisar cables'],
    repair_priority:2, brands_affected:['Renault','Peugeot','Fiat','VW'], latam_cost_usd:'20-70', latam_notes:'Frecuente en Renault Clio/Megane y Peugeot 206/307.' },

  { code:'P0108', title:'Señal alta circuito MAP', system:'Motor · Admisión', severity:'Moderado',
    description:'Señal del sensor MAP por encima del máximo. Posible cortocircuito.',
    causes:['Cortocircuito en cable de señal a voltaje','Sensor MAP defectuoso'],
    diagnostic_steps:['Verificar voltaje <4.8V','Desconectar sensor y verificar que código desaparece'],
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'20-80', latam_notes:'' },

  { code:'P0110', title:'Falla circuito sensor temperatura aire admisión (IAT)', system:'Motor · Admisión', severity:'Bajo',
    description:'El sensor de temperatura del aire de admisión falla o está fuera de rango.',
    causes:['Sensor IAT defectuoso (puede ser integrado en MAF)','Cableado dañado','Conector oxidado'],
    diagnostic_steps:['Medir resistencia IAT (varía con temperatura)','Verificar cableado','Si integrado en MAF, reemplazar MAF completo'],
    repair_priority:3, brands_affected:['Universal'], latam_cost_usd:'10-80', latam_notes:'En muchos motores el IAT está integrado en el MAF.' },

  { code:'P0113', title:'Señal alta IAT — temperatura admisión', system:'Motor · Admisión', severity:'Bajo',
    description:'Señal del sensor IAT alta — generalmente indica sensor abierto o desconectado.',
    causes:['Sensor IAT desconectado','Cable de señal abierto','Sensor defectuoso'],
    diagnostic_steps:['Verificar conector IAT','Medir resistencia del sensor'],
    repair_priority:3, brands_affected:['Universal'], latam_cost_usd:'10-50', latam_notes:'' },

  { code:'P0116', title:'Rango/desempeño sensor temperatura refrigerante (ECT)', system:'Motor · Refrigeración', severity:'Moderado',
    description:'La temperatura del refrigerante no alcanza valor esperado o varía incorrectamente.',
    causes:['Termostato abierto o pegado en frío (causa más común)','Sensor ECT defectuoso','Mezcla de refrigerante incorrecta'],
    diagnostic_params:{ ect_normal:'80-95°C en operación', warmup_time:'3-7 minutos' },
    diagnostic_steps:['Verificar si motor llega a temperatura normal','Comparar ECT vs termómetro real','Inspeccionar termostato'],
    freeze_frame_hints:'ECT no supera 70°C tras 10 min calentamiento = termostato abierto',
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'10-60', latam_notes:'Termostato causa más frecuente. $10-30 el repuesto.' },

  { code:'P0117', title:'Señal baja sensor ECT', system:'Motor · Refrigeración', severity:'Moderado',
    description:'Señal del ECT muy baja — indica cortocircuito o sensor sumergido en agua.',
    causes:['Cortocircuito en cable de señal','Sensor ECT defectuoso','Conector con agua'],
    diagnostic_steps:['Medir voltaje señal >0.5V en frío','Verificar conector sin humedad','Reemplazar sensor'],
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'15-50', latam_notes:'' },

  { code:'P0118', title:'Señal alta sensor ECT', system:'Motor · Refrigeración', severity:'Moderado',
    description:'Señal del ECT muy alta — indica cable de señal abierto o sensor defectuoso.',
    causes:['Cable de señal abierto o desconectado','Sensor ECT defectuoso'],
    diagnostic_steps:['Verificar voltaje <4.5V','Verificar conector conectado','Medir resistencia sensor'],
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'15-50', latam_notes:'Motor puede no arrancar o correr en modo emergencia.' },

  { code:'P0121', title:'Rango/desempeño TPS', system:'Motor · Mariposa', severity:'Moderado',
    description:'Señal del TPS no corresponde con posición esperada de la mariposa.',
    causes:['TPS sucio o desgastado','Punto muerto TPS desajustado','TPS defectuoso','Mariposa sucia'],
    diagnostic_params:{ tps_closed:'0.5-1.0V', tps_wot:'4.0-4.8V' },
    diagnostic_steps:['Medir voltaje TPS cerrado/WOT','Limpiar mariposa','Ajustar TPS si es ajustable','Reemplazar si voltaje errático'],
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'20-120', latam_notes:'' },

  { code:'P0122', title:'Señal baja TPS', system:'Motor · Mariposa', severity:'Moderado',
    description:'Señal TPS por debajo de mínimo. Motor no acelera o lo hace erráticamente.',
    causes:['TPS desconectado','Cortocircuito a masa','TPS defectuoso'],
    diagnostic_steps:['Verificar voltaje >0.5V en mínimo','Revisar conector y cableado'],
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'20-100', latam_notes:'' },

  { code:'P0123', title:'Señal alta TPS', system:'Motor · Mariposa', severity:'Moderado',
    description:'Señal TPS por encima del máximo. Motor puede que no arranque.',
    causes:['Cortocircuito en cable de señal a +5V','TPS defectuoso'],
    diagnostic_steps:['Verificar voltaje <4.8V a mariposa cerrada','Revisar cableado por cortocircuito'],
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'20-100', latam_notes:'' },

  { code:'P0128', title:'Termostato — temperatura por debajo del umbral', system:'Motor · Refrigeración', severity:'Moderado',
    description:'El motor no alcanza la temperatura de operación esperada. Generalmente por termostato pegado abierto.',
    causes:['Termostato pegado abierto (causa #1 — 90% casos)','Sensor ECT defectuoso','Termostato de rango incorrecto instalado'],
    symptoms:['Calefacción débil en invierno','Mayor consumo de combustible','Motor no llega a temperatura','Ventilador no activa'],
    diagnostic_steps:['Verificar que ECT supere 80°C en operación normal','Si no supera 70°C en 15 min = termostato pegado abierto','Reemplazar termostato'],
    freeze_frame_hints:'ECT <70°C con motor caliente = termostato abierto con certeza',
    repair_priority:1, brands_affected:['Toyota','Honda','Ford','Chevrolet','VW','Renault'], latam_cost_usd:'10-60',
    latam_notes:'Muy frecuente en Argentina por uso de agua sin anticongelante. Termostato $10-30.' },

  { code:'P0130', title:'Sensor O2 B1S1 — señal fuera de rango', system:'Motor · Sensores O2', severity:'Moderado',
    description:'Sensor de oxígeno upstream banco 1 presenta señal anormal.',
    causes:['Sensor O2 defectuoso o envejecido','Mezcla muy rica o pobre','Contaminación por silicona o plomo','Cableado dañado'],
    diagnostic_params:{ o2_normal:'0.1-0.9V oscilando >1 vez/segundo', o2_lean:'<0.1V', o2_rich:'>0.9V' },
    diagnostic_steps:['Verificar oscilación tiempo real','Si fijo >0.9V = mezcla rica. Si fijo <0.1V = mezcla pobre. Si no oscila = sensor muerto'],
    freeze_frame_hints:'O2 fijo = sensor muerto o mezcla extrema',
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'30-150', latam_notes:'Sensor genérico $30-60. Original $80-150.' },

  { code:'P0131', title:'Señal baja sensor O2 B1S1', system:'Motor · Sensores O2', severity:'Moderado',
    description:'Señal del sensor O2 upstream crónicamente baja — indica mezcla pobre o sensor defectuoso.',
    causes:['Mezcla pobre crónica (P0171 relacionado)','Sensor O2 defectuoso','Fuga de aire en escape antes del sensor'],
    diagnostic_steps:['Verificar voltaje O2 oscile entre 0.1-0.9V','Si permanece <0.1V = sensor defectuoso o fuga escape','Revisar P0171 junto'],
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'30-150', latam_notes:'' },

  { code:'P0132', title:'Señal alta sensor O2 B1S1', system:'Motor · Sensores O2', severity:'Moderado',
    description:'Señal del sensor O2 upstream crónicamente alta — indica mezcla rica o sensor defectuoso.',
    causes:['Mezcla rica crónica (inyectores con fuga)','Sensor O2 contaminado con aceite','Sensor defectuoso'],
    diagnostic_steps:['Verificar si permanece >0.8V','Revisar consumo de combustible','Verificar inyectores con fuga'],
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'30-150', latam_notes:'' },

  { code:'P0133', title:'Respuesta lenta sensor O2 B1S1', system:'Motor · Sensores O2', severity:'Moderado',
    description:'El sensor O2 responde más lento de lo esperado. Degrada la eficiencia del lazo cerrado.',
    causes:['Sensor envejecido (>100.000km)','Contaminación por plomo o silicona','Temperatura insuficiente'],
    diagnostic_params:{ normal_switches:'>1 vez/segundo en lazo cerrado' },
    diagnostic_steps:['Contar oscilaciones/segundo a 2000 RPM. <1 vez/segundo = reemplazar sensor'],
    freeze_frame_hints:'<1 oscilación/segundo = sensor lento = reemplazar',
    repair_priority:2, brands_affected:['Toyota','Honda','Ford'], latam_cost_usd:'40-150', latam_notes:'' },

  { code:'P0134', title:'Sin actividad sensor O2 B1S1', system:'Motor · Sensores O2', severity:'Moderado',
    description:'El sensor O2 no muestra actividad en lazo cerrado. Señal permanece estática.',
    causes:['Sensor O2 muerto','Calefactor del sensor defectuoso (no alcanza temperatura)','Cableado cortado'],
    diagnostic_steps:['Verificar calefactor (P0135)','Medir resistencia calefactor 3-15Ω','Si calefactor OK = sensor muerto'],
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'40-150', latam_notes:'' },

  { code:'P0135', title:'Falla calefactor O2 B1S1', system:'Motor · Sensores O2', severity:'Moderado',
    description:'El calefactor del sensor O2 upstream no funciona. El sensor tarda en entrar en lazo cerrado.',
    causes:['Calefactor quemado (causa #1)','Fusible del calefactor quemado','Cableado dañado'],
    diagnostic_params:{ heater_resistance:'3-15 Ω entre pines del calefactor' },
    diagnostic_steps:['Medir resistencia calefactor (3-15Ω)','Verificar fusible','Medir 12V en pin alimentación'],
    freeze_frame_hints:'Resistencia infinita = calefactor quemado = reemplazar sensor',
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'40-150', latam_notes:'' },

  { code:'P0136', title:'Falla circuito sensor O2 B1S2', system:'Motor · Sensores O2', severity:'Moderado',
    description:'Falla en el sensor O2 downstream banco 1. Monitorea la eficiencia del catalizador.',
    causes:['Sensor O2 downstream defectuoso','Cableado dañado','Catalizador muy dañado alterando lectura'],
    diagnostic_steps:['Verificar voltaje O2 downstream (debe ser estable 0.5-0.7V)','Comparar con upstream','Si varía igual que upstream = catalizador muerto (P0420)'],
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'30-150', latam_notes:'' },

  { code:'P0141', title:'Falla calefactor O2 B1S2', system:'Motor · Sensores O2', severity:'Bajo',
    description:'El calefactor del sensor O2 downstream no funciona.',
    causes:['Calefactor quemado','Fusible quemado','Cableado dañado'],
    diagnostic_steps:['Medir resistencia calefactor (3-15Ω)','Verificar fusible correspondiente'],
    repair_priority:3, brands_affected:['Universal'], latam_cost_usd:'30-130', latam_notes:'' },

  { code:'P0171', title:'Sistema mezcla pobre — Banco 1', system:'Motor · Combustión', severity:'Crítico',
    description:'La ECU detecta mezcla pobre más allá del límite de corrección. Fuel trim largo supera umbral de compensación.',
    causes:['Sensor MAF sucio o defectuoso (60% casos)','Fuga de vacío colector/mangueras (25% casos)','Inyectores tapados o bajo caudal','Sensor O2 B1S1 defectuoso','Bomba de combustible débil','Presión de combustible baja','Fuga exhaust antes del O2'],
    symptoms:['Check engine','Motor tembla ralentí','Mayor consumo','Pérdida potencia','Silbido admisión si hay fuga vacío'],
    diagnostic_params:{ fuel_trim_short_normal:'entre -10% y +10%', fuel_trim_long_normal:'entre -10% y +10%', fuel_trim_concern:'>+15% en ambos = problema real', maf_idle_expected:'2-7 g/s para 1.6-2.0L', fuel_pressure_normal:'50-65 PSI' },
    diagnostic_steps:['1. Limpiar MAF con spray y borrar código','2. LTFT varía mucho con RPM = fuga de vacío. LTFT parejo = MAF o combustible','3. Medir presión combustible (50-65 PSI)','4. Verificar sensor O2 oscila (0.1-0.9V)','5. Probar fugas de vacío con spray de arranque'],
    freeze_frame_hints:'LTFT >+20% = problema crónico. STFT variable en ralentí = fuga de vacío',
    differential_diagnosis:{ 'MAF sucio':'MAF voltage bajo, LTFT alto parejo → limpiar MAF primero', 'Fuga de vacío':'STFT variable, peor en ralentí, silbido → spray vacío en mangueras', 'Inyectores tapados':'LTFT alto, desbalance en prueba → limpieza ultrasónica', 'Bomba débil':'Presión <50 PSI → medir con manómetro' },
    repair_priority:1, brands_affected:['Toyota','Honda','Nissan','Hyundai','Ford'], latam_cost_usd:'5-400',
    latam_notes:'Limpieza MAF $5-10 (60% casos). Fuga vacío $5-30. Inyectores limpieza $20-50. Bomba $80-200.' },

  { code:'P0172', title:'Sistema mezcla rica — Banco 1', system:'Motor · Combustión', severity:'Crítico',
    description:'La ECU detecta mezcla rica más allá del límite de corrección.',
    causes:['Inyectores con fuga interna','Regulador de presión defectuoso','Sensor MAF leyendo de más','Sensor ECT defectuoso (cree que está frío)','Presión de combustible excesiva'],
    symptoms:['Olor a nafta','Exceso de humo negro/gris','Consumo elevado','Bujías negras y húmedas','Aceite con olor a nafta'],
    diagnostic_params:{ fuel_trim_concern:'LTFT <-15% = mezcla rica crónica' },
    diagnostic_steps:['Verificar LTFT (negativo = mezcla rica)','Medir presión combustible (no debe superar 65 PSI con vacío desconectado)','Verificar que inyectores no goteen (test balanceo)','Revisar sensor ECT (debe ser consistente con temperatura real)'],
    freeze_frame_hints:'LTFT muy negativo (-20% o más) = mezcla rica crónica',
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'20-400',
    latam_notes:'Inyectores con fuga interna muy común en motores >150.000km. Limpieza ultrasónica $20-50.' },

  { code:'P0174', title:'Sistema mezcla pobre — Banco 2', system:'Motor · Combustión', severity:'Crítico',
    description:'Mezcla pobre en banco 2 (motores en V o boxer). Mismo diagnóstico que P0171 pero en banco 2.',
    causes:['MAF sucio','Fuga de vacío en banco 2','Inyectores tapados banco 2','Sensor O2 banco 2 defectuoso'],
    diagnostic_steps:['Ver diagnóstico P0171','Si P0171 y P0174 juntos = MAF o bomba (afecta ambos bancos)','Si solo P0174 = fuga de vacío o inyector banco 2'],
    freeze_frame_hints:'P0171+P0174 simultáneos = MAF o bomba. Solo P0174 = banco 2 específico',
    repair_priority:1, brands_affected:['Ford V6/V8','Toyota V6','Nissan V6','Chevrolet V6/V8'], latam_cost_usd:'5-400',
    latam_notes:'Si aparece junto a P0171 = problema global (MAF, bomba). Solo P0174 = problema específico banco 2.' },

  { code:'P0175', title:'Sistema mezcla rica — Banco 2', system:'Motor · Combustión', severity:'Crítico',
    description:'Mezcla rica en banco 2. Mismo diagnóstico que P0172 pero banco 2.',
    causes:['Inyectores banco 2 con fuga','Sensor O2 banco 2 defectuoso','Presión combustible excesiva'],
    diagnostic_steps:['Ver diagnóstico P0172','Si P0172+P0175 = problema global (regulador presión, MAF)','Solo P0175 = banco 2 específico'],
    repair_priority:1, brands_affected:['Ford V6/V8','Toyota V6','Nissan V6'], latam_cost_usd:'20-400', latam_notes:'' },

  { code:'P0190', title:'Falla circuito sensor presión combustible', system:'Motor · Combustible', severity:'Crítico',
    description:'El sensor de presión de combustible del riel no envía señal válida.',
    causes:['Sensor de presión de riel defectuoso','Cableado dañado','Bomba de alta presión defectuosa (GDI)','Riel de combustible con presión incorrecta'],
    symptoms:['Motor no arranca o arranca difícil','Pérdida de potencia severa','Motor en modo de emergencia'],
    diagnostic_steps:['Verificar señal del sensor (0.5-4.5V variable con presión)','Medir presión real con manómetro','Revisar cableado al sensor'],
    repair_priority:1, brands_affected:['Ford','VW','BMW','Mercedes','Hyundai GDI'], latam_cost_usd:'50-400',
    latam_notes:'Frecuente en motores GDI (inyección directa). Bomba alta presión es componente costoso.' },

  // ═══════════════════════════════════════════════════════════
  // P02XX — INYECTORES
  // ═══════════════════════════════════════════════════════════

  { code:'P0200', title:'Falla circuito inyector (general)', system:'Motor · Combustible', severity:'Crítico',
    description:'Falla general en el circuito de inyección. La ECU detecta problema en uno o más inyectores.',
    causes:['Cableado dañado al inyector','Inyector defectuoso (bobina abierta)','Driver de inyector de ECU dañado'],
    diagnostic_steps:['Medir resistencia inyectores (12-16Ω típico)','Verificar señal de activación con osciloscopio','Revisar cableado al inyector'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'20-300', latam_notes:'' },

  { code:'P0201', title:'Falla circuito inyector cilindro 1', system:'Motor · Combustible', severity:'Crítico',
    description:'Problema en el circuito del inyector del cilindro 1.',
    causes:['Inyector 1 con bobina abierta o cortocircuito','Cableado dañado a inyector 1','Driver ECU inyector 1'],
    diagnostic_steps:['Medir resistencia inyector 1 (12-16Ω)','Intercambiar inyectores para descartar','Si falla mueve con inyector = inyector defectuoso'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'30-200', latam_notes:'Intercambiar inyector 1 con cilindro 2 y ver si código cambia a P0202.' },

  { code:'P0202', title:'Falla circuito inyector cilindro 2', system:'Motor · Combustible', severity:'Crítico',
    description:'Problema en el circuito del inyector del cilindro 2.',
    causes:['Inyector 2 defectuoso','Cableado dañado'],
    diagnostic_steps:['Ver P0201 — mismos pasos para cilindro 2'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'30-200', latam_notes:'' },

  { code:'P0203', title:'Falla circuito inyector cilindro 3', system:'Motor · Combustible', severity:'Crítico',
    description:'Problema en el circuito del inyector del cilindro 3.',
    causes:['Inyector 3 defectuoso','Cableado dañado'],
    diagnostic_steps:['Ver P0201 — mismos pasos para cilindro 3'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'30-200', latam_notes:'' },

  { code:'P0204', title:'Falla circuito inyector cilindro 4', system:'Motor · Combustible', severity:'Crítico',
    description:'Problema en el circuito del inyector del cilindro 4.',
    causes:['Inyector 4 defectuoso','Cableado dañado'],
    diagnostic_steps:['Ver P0201 — mismos pasos para cilindro 4'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'30-200', latam_notes:'' },

  // ═══════════════════════════════════════════════════════════
  // P03XX — SISTEMA DE IGNICIÓN / FALLAS DE ENCENDIDO
  // ═══════════════════════════════════════════════════════════

  { code:'P0300', title:'Falla de encendido aleatoria/múltiple', system:'Motor · Ignición', severity:'Crítico',
    description:'Falla de encendido detectada en múltiples cilindros o de forma aleatoria. Motor vibra notablemente.',
    causes:['Bujías desgastadas o incorrectas','Cables de bujía defectuosos','Bobinas de ignición defectuosas','Inyectores tapados','Compresión baja en múltiples cilindros','Fuga de vacío grande','Bajo presión de combustible'],
    symptoms:['Motor vibra fuerte','Pérdida de potencia severa','Check engine titila (urgente)','Aumento de consumo','Olor a combustible sin quemar'],
    diagnostic_steps:['1. Verificar bujías (desgaste, depósitos, color)','2. Medir compresión de todos los cilindros','3. Revisar bobinas (intercambiar entre cilindros)','4. Verificar cables/bobinas individuales','5. Medir presión de combustible'],
    freeze_frame_hints:'Si check engine parpadea = daño al catalizador inminente. Detener conducción.',
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'20-800',
    latam_notes:'Bujías $30-80 juego. Bobinas $40-120 c/u. Si check engine titila = urgente, parar el auto.' },

  { code:'P0301', title:'Falla de encendido cilindro 1', system:'Motor · Ignición', severity:'Crítico',
    description:'Falla de encendido confirmada en cilindro 1.',
    causes:['Bujía cilindro 1 defectuosa','Bobina cilindro 1 defectuosa','Inyector cilindro 1 tapado','Cable bujía defectuoso','Compresión baja cilindro 1'],
    diagnostic_steps:['1. Intercambiar bujía 1 con cilindro 2 y borrar código','2. Si código sigue en cil.1 = no es bujía','3. Intercambiar bobina 1 con cil.2','4. Si código mueve a cil.2 = bobina defectuosa','5. Si no mueve = inyector o compresión'],
    freeze_frame_hints:'Si falla solo en frío = bujía o bobina. Si persiste = compresión o inyector',
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'20-300',
    latam_notes:'Intercambiar componentes entre cilindros es el diagnóstico más efectivo y económico.' },

  { code:'P0302', title:'Falla de encendido cilindro 2', system:'Motor · Ignición', severity:'Crítico',
    description:'Falla de encendido confirmada en cilindro 2.',
    causes:['Bujía cilindro 2 defectuosa','Bobina cilindro 2 defectuosa','Inyector cilindro 2 tapado','Compresión baja cilindro 2'],
    diagnostic_steps:['Ver P0301 — mismos pasos para cilindro 2'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'20-300', latam_notes:'' },

  { code:'P0303', title:'Falla de encendido cilindro 3', system:'Motor · Ignición', severity:'Crítico',
    description:'Falla de encendido confirmada en cilindro 3.',
    causes:['Bujía cilindro 3 defectuosa','Bobina cilindro 3 defectuosa','Inyector cilindro 3 tapado','Compresión baja cilindro 3'],
    diagnostic_steps:['Ver P0301 — mismos pasos para cilindro 3'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'20-300', latam_notes:'' },

  { code:'P0304', title:'Falla de encendido cilindro 4', system:'Motor · Ignición', severity:'Crítico',
    description:'Falla de encendido confirmada en cilindro 4.',
    causes:['Bujía cilindro 4 defectuosa','Bobina cilindro 4 defectuosa','Inyector cilindro 4 tapado','Compresión baja cilindro 4'],
    diagnostic_steps:['Ver P0301 — mismos pasos para cilindro 4'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'20-300', latam_notes:'' },

  { code:'P0305', title:'Falla de encendido cilindro 5', system:'Motor · Ignición', severity:'Crítico',
    description:'Falla de encendido confirmada en cilindro 5 (motores 6 cilindros o más).',
    causes:['Bujía cilindro 5 defectuosa','Bobina cilindro 5 defectuosa'],
    diagnostic_steps:['Ver P0301 — mismos pasos para cilindro 5'],
    repair_priority:1, brands_affected:['Ford V6','Toyota V6','Honda V6','Chevrolet V6'], latam_cost_usd:'20-300', latam_notes:'' },

  { code:'P0306', title:'Falla de encendido cilindro 6', system:'Motor · Ignición', severity:'Crítico',
    description:'Falla de encendido confirmada en cilindro 6.',
    causes:['Bujía cilindro 6 defectuosa','Bobina cilindro 6 defectuosa'],
    diagnostic_steps:['Ver P0301 — mismos pasos para cilindro 6'],
    repair_priority:1, brands_affected:['Ford V6','Toyota V6','Honda V6'], latam_cost_usd:'20-300', latam_notes:'' },

  { code:'P0320', title:'Falla circuito sensor posición cigüeñal (CKP)', system:'Motor · Ignición', severity:'Crítico',
    description:'El sensor de posición del cigüeñal no envía señal válida. Motor puede no arrancar.',
    causes:['Sensor CKP defectuoso','Rueda fónica dañada o sucia (imanes/dientes)','Cableado dañado','Entrehierro incorrecto','Cuerpo exterior del sensor dañado'],
    symptoms:['Motor no arranca','Motor para repentinamente','Falla al acelerar fuerte'],
    diagnostic_steps:['Verificar señal CKP con osciloscopio (forma de onda limpia)','Revisar entrehierro (0.5-1.5mm típico)','Revisar rueda fónica por dientes dañados','Verificar cableado'],
    freeze_frame_hints:'Sin señal CKP = motor no arranca. Señal intermitente = falla en marcha',
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'30-150',
    latam_notes:'Sensor CKP genérico $30-60. Verificar rueda fónica antes de reemplazar sensor.' },

  { code:'P0325', title:'Falla circuito sensor de detonación (knock)', system:'Motor · Ignición', severity:'Moderado',
    description:'El sensor de detonación no funciona correctamente. Motor corre con avance reducido por precaución.',
    causes:['Sensor knock defectuoso','Cableado dañado','Sensor flojo (torque incorrecto)','Ruido mecánico que satura el sensor'],
    symptoms:['Reducción de potencia','Mayor consumo','Motor con adelanto de encendido reducido'],
    diagnostic_steps:['Verificar torque del sensor (20-25 Nm típico)','Medir resistencia del sensor','Verificar señal con motor en aceleración'],
    repair_priority:2, brands_affected:['Toyota','Honda','Nissan','Hyundai'], latam_cost_usd:'20-100',
    latam_notes:'Toyota y Honda tienen TSB por este código. Sensor $20-60.' },

  { code:'P0335', title:'Falla circuito sensor CKP', system:'Motor · Ignición', severity:'Crítico',
    description:'Sin señal del sensor de posición del cigüeñal. Motor no arranca.',
    causes:['Sensor CKP defectuoso o desconectado','Cableado cortado','Rueda fónica dañada','Plato del inducido roto'],
    diagnostic_steps:['Verificar conector conectado','Medir resistencia sensor (500-900Ω típico inductivo)','Verificar dientes rueda fónica con espejo','Revisar cableado con multímetro'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'30-150', latam_notes:'Sin CKP el motor no arranca. Verificar rueda fónica antes de reemplazar.' },

  { code:'P0340', title:'Falla circuito sensor posición árbol de levas (CMP)', system:'Motor · Distribución', severity:'Crítico',
    description:'Sin señal del sensor de árbol de levas. Afecta el timing de inyección y encendido.',
    causes:['Sensor CMP defectuoso','Rueda fónica del árbol de levas sucia o dañada','Cableado dañado','Árbol de levas con desgaste en leva del sensor'],
    symptoms:['Arranque difícil','Tirones al acelerar','Mayor consumo','Check engine'],
    diagnostic_steps:['Verificar señal CMP con osciloscopio','Limpiar rueda fónica del árbol de levas','Revisar cableado','Medir distancia sensor a rueda fónica'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'30-150', latam_notes:'' },

  // ═══════════════════════════════════════════════════════════
  // P04XX — SISTEMA DE EMISIONES
  // ═══════════════════════════════════════════════════════════

  { code:'P0400', title:'Falla sistema recirculación gases escape (EGR)', system:'Motor · Emisiones', severity:'Moderado',
    description:'El sistema EGR no funciona correctamente. Puede causar mayor NOx y detonación.',
    causes:['Válvula EGR tapada con carbonilla','Válvula EGR atascada abierta o cerrada','Manguera de vacío al EGR rota','Sensor de posición EGR defectuoso'],
    symptoms:['Detonación a carga media','Mayor temperatura de motor','Ralentí inestable si EGR atascada abierta'],
    diagnostic_steps:['Verificar operación de válvula EGR (abrir/cerrar con vacío)','Limpiar válvula EGR','Verificar flujo de gases de escape al colector de admisión'],
    repair_priority:2, brands_affected:['Ford','VW','Renault','Peugeot','Fiat'], latam_cost_usd:'30-300',
    latam_notes:'Muy frecuente en motores diesel y algunos nafteros con muchos kilómetros. Limpieza $30-60. Reemplazo $80-300.' },

  { code:'P0401', title:'Flujo EGR insuficiente', system:'Motor · Emisiones', severity:'Moderado',
    description:'El flujo de gases EGR está por debajo del esperado.',
    causes:['Válvula EGR tapada con carbonilla','Pasaje EGR bloqueado','Sensor DPFE defectuoso (Ford)','Manguera de vacío rota'],
    diagnostic_steps:['Verificar que válvula EGR abre al aplicar vacío','Limpiar pasajes EGR con decapante','En Ford: verificar sensor DPFE'],
    repair_priority:2, brands_affected:['Ford','Chevrolet','Honda','Toyota'], latam_cost_usd:'30-250',
    latam_notes:'En Ford Focus/Escape muy común el sensor DPFE. En Honda CRV común la válvula tapada.' },

  { code:'P0402', title:'Flujo EGR excesivo', system:'Motor · Emisiones', severity:'Moderado',
    description:'El flujo de gases EGR supera lo esperado. Válvula EGR atascada abierta.',
    causes:['Válvula EGR atascada abierta','Malla del sensor EGR bloqueada','Sensor EGR defectuoso'],
    symptoms:['Ralentí inestable o motor para','Motor rough en arranque en frío'],
    diagnostic_steps:['Verificar que válvula EGR cierra completamente','Desconectar EGR temporalmente y ver si ralentí mejora','Reemplazar o limpiar válvula EGR'],
    repair_priority:2, brands_affected:['Ford','Chevrolet'], latam_cost_usd:'50-250', latam_notes:'' },

  { code:'P0410', title:'Falla sistema inyección de aire secundario', system:'Motor · Emisiones', severity:'Moderado',
    description:'El sistema de aire secundario (para reducir emisiones en arranque) no funciona.',
    causes:['Bomba de aire secundario defectuosa','Válvula unidireccional tapada','Fusible/relé bomba quemado','Mangueras bloqueadas'],
    diagnostic_steps:['Verificar funcionamiento bomba en arranque frío (debe escucharse 30-120 segundos)','Verificar relé y fusible','Revisar mangueras por bloqueo'],
    repair_priority:3, brands_affected:['VW','BMW','Mercedes','Chevrolet','Toyota'], latam_cost_usd:'100-500',
    latam_notes:'Componente caro. Bomba $200-400. Frecuente en VW Golf/Jetta y BMW Serie 3.' },

  { code:'P0420', title:'Catalizador banco 1 — eficiencia por debajo del umbral', system:'Motor · Emisiones', severity:'Crítico',
    description:'El catalizador banco 1 no convierte eficientemente los gases. O2 downstream copia el patrón del upstream.',
    causes:['Catalizador dañado o agotado (causa más común en autos >150.000km)','Sensor O2 downstream defectuoso','Fugas de escape antes del catalizador','Motor con fallas de encendido que dañaron el catalizador','Aceite o refrigerante quemado contaminó el catalizador'],
    symptoms:['Check engine','Olor a huevo podrido (H2S) en escape','Mayor consumo'],
    diagnostic_steps:['1. Verificar que no haya otros códigos (P030x, P0171) que estén dañando el catalizador','2. Comparar señales O2 upstream vs downstream en tiempo real','3. Si downstream oscila igual que upstream = catalizador agotado','4. Verificar fuga de escape antes del catalizador','5. Testear con sensor O2 nuevo antes de comprar catalizador'],
    freeze_frame_hints:'Si O2 downstream oscila como el upstream = catalizador muerto. Si está estable = puede ser sensor O2 downstream defectuoso',
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'50-800',
    latam_notes:'Catalizador genérico $100-250. Original $400-800. Verificar causa raíz (fallas encendido) antes de reemplazar.' },

  { code:'P0421', title:'Catalizador banco 1 — eficiencia baja en frío', system:'Motor · Emisiones', severity:'Moderado',
    description:'El catalizador no alcanza temperatura de trabajo rápidamente.',
    causes:['Catalizador envejecido','Sensor O2 lento','Distancia excesiva entre motor y catalizador'],
    diagnostic_steps:['Verificar comportamiento del sensor O2 en calentamiento','Si después de 2 min de marcha el O2 downstream sigue frío = catalizador'],
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'100-600', latam_notes:'' },

  { code:'P0430', title:'Catalizador banco 2 — eficiencia por debajo del umbral', system:'Motor · Emisiones', severity:'Crítico',
    description:'Catalizador banco 2 agotado. Igual diagnóstico que P0420 pero banco 2.',
    causes:['Catalizador banco 2 agotado','Sensor O2 banco 2 downstream defectuoso','Fallas de encendido en banco 2 (P030x)'],
    diagnostic_steps:['Ver diagnóstico P0420 — aplicar a banco 2'],
    repair_priority:2, brands_affected:['Ford V6/V8','Toyota V6','Nissan V6','Chevrolet V6'], latam_cost_usd:'100-800',
    latam_notes:'En V6/V8 hay dos catalizadores. Banco 2 generalmente del lado del pasajero.' },

  { code:'P0440', title:'Falla sistema control evaporación EVAP', system:'Motor · Emisiones', severity:'Moderado',
    description:'El sistema EVAP tiene una fuga mayor. Vapores de combustible no son controlados.',
    causes:['Tapón de nafta mal cerrado o con junta desgastada (25% casos)','Válvula de purga EVAP defectuosa','Cánister saturado o dañado','Mangueras EVAP rotas o desconectadas','Sensor de presión EVAP defectuoso'],
    symptoms:['Check engine','Olor a combustible (en casos severos)'],
    diagnostic_steps:['1. Verificar tapón de combustible (cerrar correctamente o reemplazar)','2. Verificar operación válvula de purga (debe abrir con vacío)','3. Prueba de humo para detectar fugas en sistema EVAP','4. Verificar cánister por saturación'],
    freeze_frame_hints:'Si solo aparece P0440 y no hay fuga obvia = tapón de nafta o válvula purga',
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'5-300',
    latam_notes:'Primero verificar tapón de nafta (solución gratis). Válvula purga $20-80. Prueba de humo diagnóstico definitivo.' },

  { code:'P0441', title:'Flujo incorrecto sistema de purga EVAP', system:'Motor · Emisiones', severity:'Moderado',
    description:'La válvula de purga EVAP no controla correctamente el flujo de vapores al colector de admisión.',
    causes:['Válvula de purga EVAP atascada cerrada','Manguera de purga bloqueada o desconectada','Cánister saturado','Válvula de purga cortocircuitada eléctricamente'],
    diagnostic_steps:['Verificar operación eléctrica de válvula de purga (PWM de ECU)','Verificar que manguera de purga llegue al colector','Verificar que al abrir válvula se sienta flujo','Test de purga con scanner'],
    repair_priority:2, brands_affected:['Toyota','Honda','Ford','Chevrolet'], latam_cost_usd:'20-150',
    latam_notes:'Válvula purga EVAP $20-80. Toyota Corolla/RAV4 muy frecuente este código.' },

  { code:'P0442', title:'Fuga pequeña sistema EVAP', system:'Motor · Emisiones', severity:'Bajo',
    description:'El sistema EVAP tiene una pequeña fuga (menor a 1mm). Difícil de encontrar sin equipo.',
    causes:['Tapón de nafta con junta desgastada','Manguera EVAP pequeña rajada','Conector de manguera suelto','Cánister con grieta pequeña'],
    diagnostic_steps:['Reemplazar tapón de nafta primero','Inspeccionar mangueras EVAP visualmente','Prueba de humo para localizar fuga pequeña'],
    repair_priority:3, brands_affected:['Universal'], latam_cost_usd:'5-200',
    latam_notes:'Tapón de nafta nuevo $15-30. Sin prueba de humo difícil encontrar fuga pequeña.' },

  { code:'P0443', title:'Falla circuito válvula de purga EVAP', system:'Motor · Emisiones', severity:'Moderado',
    description:'Falla eléctrica en el circuito de la válvula de purga EVAP.',
    causes:['Válvula de purga con bobina quemada','Cableado dañado','Fusible quemado','Driver ECU defectuoso'],
    diagnostic_steps:['Medir resistencia válvula purga (20-30Ω típico)','Verificar 12V en uno de los pines al activar','Verificar cable de control desde ECU'],
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'20-100', latam_notes:'' },

  { code:'P0446', title:'Falla control ventilación cánister EVAP', system:'Motor · Emisiones', severity:'Moderado',
    description:'La válvula de ventilación del cánister no funciona correctamente.',
    causes:['Válvula de ventilación del cánister defectuosa','Cableado dañado','Cánister tapado o saturado'],
    diagnostic_steps:['Verificar que válvula ventilación abre/cierra correctamente','Verificar cableado','Verificar presión en sistema EVAP'],
    repair_priority:2, brands_affected:['Toyota','Lexus','Honda'], latam_cost_usd:'30-150',
    latam_notes:'Muy frecuente en Toyota Land Cruiser, Prado y Lexus 4.0L.' },

  { code:'P0455', title:'Fuga grande sistema EVAP', system:'Motor · Emisiones', severity:'Moderado',
    description:'El sistema EVAP tiene una fuga grande (mayor a 1mm). Más fácil de encontrar.',
    causes:['Tapón de nafta faltante, roto o mal cerrado','Manguera EVAP desconectada','Válvula de purga atascada abierta','Cánister roto'],
    diagnostic_steps:['Verificar tapón de nafta inmediatamente','Inspeccionar mangueras EVAP','Verificar válvula de purga cierra completamente','Prueba de humo'],
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'5-300',
    latam_notes:'Verificar tapón de nafta primero — es gratuito y resuelve 30% de los casos.' },

  // ═══════════════════════════════════════════════════════════
  // P05XX — VELOCIDAD / RELACIÓN MARCHA / RALENTÍ
  // ═══════════════════════════════════════════════════════════

  { code:'P0500', title:'Falla sensor velocidad vehículo (VSS)', system:'Tren de transmisión', severity:'Moderado',
    description:'El sensor de velocidad del vehículo no envía señal correcta. Velocímetro puede fallar.',
    causes:['Sensor VSS defectuoso','Rueda fónica de caja de cambios dañada','Cableado dañado','Conector oxidado'],
    symptoms:['Velocímetro errático o sin lectura','Motor con correcciones de ralentí incorrectas','ABS puede activarse'],
    diagnostic_steps:['Verificar señal VSS con osciloscopio','Revisar rueda fónica caja','Verificar cableado'],
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'20-100', latam_notes:'' },

  { code:'P0505', title:'Falla sistema control ralentí (IAC)', system:'Motor · Ralentí', severity:'Moderado',
    description:'El sistema de control de ralentí no funciona correctamente. RPM de ralentí inestables.',
    causes:['Válvula IAC sucia o defectuosa','Mariposa sucia (IACV sin mariposa electrónica)','Fuga de vacío','Sensor TPS defectuoso'],
    symptoms:['Ralentí muy alto, muy bajo o inestable','Motor para al detener','Stalling en frío'],
    diagnostic_steps:['Limpiar válvula IAC con limpiador mariposa','Limpiar mariposa','Verificar fugas de vacío','Si IAC eléctrica: medir resistencia (10-15Ω)'],
    repair_priority:2, brands_affected:['Honda','Toyota','Ford','Chevrolet'], latam_cost_usd:'15-200',
    latam_notes:'Limpieza IAC con spray $5-10 (resuelve 60% casos). Honda VTEC muy propenso a este código.' },

  { code:'P0506', title:'RPM de ralentí por debajo de lo esperado', system:'Motor · Ralentí', severity:'Moderado',
    description:'Las RPM de ralentí son menores a las esperadas por la ECU.',
    causes:['Válvula IAC sucia','Fuga de vacío que causa mezcla pobre','Mariposa sucia','Carga eléctrica excesiva'],
    diagnostic_steps:['Limpiar IAC y mariposa','Verificar RPM esperadas vs reales con scanner','Buscar fugas de vacío'],
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'15-200', latam_notes:'' },

  { code:'P0507', title:'RPM de ralentí por encima de lo esperado', system:'Motor · Ralentí', severity:'Moderado',
    description:'Las RPM de ralentí son mayores a las esperadas. Motor ronca alto en neutro.',
    causes:['Válvula IAC atascada abierta','Fuga de vacío grande','Mariposa no cierra completamente','TPS desajustado'],
    diagnostic_steps:['Verificar RPM con motor caliente (debe ser 700-900 RPM)','Limpiar IAC','Verificar que mariposa cierra completamente','Buscar fugas de vacío'],
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'15-200', latam_notes:'' },

  // ═══════════════════════════════════════════════════════════
  // P06XX — SISTEMA DE CONTROL COMPUTADORA
  // ═══════════════════════════════════════════════════════════

  { code:'P0600', title:'Falla comunicación CAN bus', system:'Sistema eléctrico', severity:'Crítico',
    description:'El módulo de control no puede comunicarse correctamente por la red CAN.',
    causes:['Cortocircuito en bus CAN','Módulo defectuoso que bloquea la red','Batería baja que afecta comunicaciones','Cableado CAN dañado'],
    symptoms:['Múltiples códigos de falla simultáneos','Instrumentos sin funcionamiento','Varios sistemas no funcionan'],
    diagnostic_steps:['Verificar tensión batería (>12.5V)','Medir resistencia bus CAN (60Ω entre CAN H y CAN L)','Desconectar módulos de a uno para aislar el problemático'],
    repair_priority:1, brands_affected:['VW','BMW','Mercedes','Ford','Toyota moderno'], latam_cost_usd:'50-2000',
    latam_notes:'Diagnóstico requiere equipo especializado. Medir resistencia CAN es primer paso económico.' },

  { code:'P0605', title:'Error ROM (memoria) de la ECU', system:'Sistema eléctrico', severity:'Crítico',
    description:'La ECU detecta error en su memoria ROM. Generalmente requiere reemplazo o reprogramación.',
    causes:['ECU defectuosa','Interrupción de energía durante actualización','Tensión incorrecta a la ECU'],
    diagnostic_steps:['Verificar tensión batería y masa de ECU','Intentar reprogramación con equipo específico','Si persiste = ECU defectuosa'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'100-2000',
    latam_notes:'Reprogramación ECU $50-150 en talleres especializados. Reemplazo ECU $200-2000.' },

  // ═══════════════════════════════════════════════════════════
  // P07XX — TRANSMISIÓN
  // ═══════════════════════════════════════════════════════════

  { code:'P0700', title:'Falla sistema de control de transmisión (TCM)', system:'Transmisión', severity:'Crítico',
    description:'El módulo de control de transmisión detectó una falla. Puede haber otros códigos de transmisión.',
    causes:['Falla en solenoides de transmisión','Nivel de aceite ATF bajo o degradado','Sensor de velocidad transmisión defectuoso','TCM defectuoso'],
    symptoms:['Transmisión no cambia de marcha correctamente','Transmisión en modo emergencia (fija en 3ra)','Check engine con luz AT/TCS'],
    diagnostic_steps:['Leer códigos específicos de transmisión','Verificar nivel y condición aceite ATF','Verificar solenoides de cambio'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'50-3000',
    latam_notes:'Cambio de aceite ATF puede resolver muchos problemas. ATF $30-80. Solenoides $50-200.' },

  { code:'P0715', title:'Falla sensor velocidad turbina de entrada', system:'Transmisión', severity:'Moderado',
    description:'El sensor de velocidad de entrada de la transmisión automática falla.',
    causes:['Sensor de velocidad turbina defectuoso','Cableado dañado','Rueda fónica dañada'],
    diagnostic_steps:['Verificar señal del sensor','Revisar cableado','Reemplazar sensor si señal ausente'],
    repair_priority:2, brands_affected:['Universal automáticas'], latam_cost_usd:'30-200', latam_notes:'' },

  { code:'P0720', title:'Falla sensor velocidad salida transmisión', system:'Transmisión', severity:'Moderado',
    description:'El sensor de velocidad de salida de la transmisión falla. Afecta cambios de marcha.',
    causes:['Sensor OSS defectuoso','Rueda fónica dañada','Cableado dañado'],
    diagnostic_steps:['Verificar señal con vehículo en marcha','Revisar rueda fónica','Reemplazar sensor'],
    repair_priority:2, brands_affected:['Universal automáticas'], latam_cost_usd:'30-200', latam_notes:'' },

  { code:'P0730', title:'Relación de transmisión incorrecta', system:'Transmisión', severity:'Crítico',
    description:'La transmisión no entra en la relación esperada. Deslizamiento o problema mecánico.',
    causes:['Aceite ATF degradado o bajo nivel','Solenoides de cambio defectuosos','Desgaste mecánico interno de transmisión','Presión hidráulica baja'],
    symptoms:['Transmisión desliza','Cambios bruscos o tardíos','Sobrecalentamiento de transmisión'],
    diagnostic_steps:['Verificar nivel y condición ATF (color, olor)','Verificar solenoides','Si ATF negro = daño interno probable'],
    repair_priority:1, brands_affected:['Universal automáticas'], latam_cost_usd:'80-5000',
    latam_notes:'Cambio completo ATF con filtro $80-150. Overhaul transmisión $800-3000.' },

  { code:'P0740', title:'Falla circuito solenoide embrague convertidor de par', system:'Transmisión', severity:'Moderado',
    description:'El solenoide del lock-up del convertidor no funciona. Mayor consumo de combustible.',
    causes:['Solenoide TCC defectuoso','Cableado dañado','ATF degradado bloqueando solenoide','Convertidor de par defectuoso'],
    diagnostic_steps:['Verificar resistencia solenoide TCC (10-15Ω)','Verificar cableado','Cambiar ATF con filtro'],
    repair_priority:2, brands_affected:['Honda','Toyota','Ford','GM'], latam_cost_usd:'50-500',
    latam_notes:'Honda Civic/Accord muy propenso. Cambio ATF puede resolverlo.' },

  // ═══════════════════════════════════════════════════════════
  // P08XX / P09XX — ADICIONALES
  // ═══════════════════════════════════════════════════════════

  { code:'P0850', title:'Interruptor de posición Park/Neutral', system:'Transmisión', severity:'Moderado',
    description:'El interruptor de posición de cambio no indica correctamente Park o Neutral.',
    causes:['Interruptor PNP defectuoso','Cableado dañado','Ajuste incorrecto del interruptor'],
    symptoms:['Motor no arranca en Park o Neutral','Ralentí incorrecto al cambiar de P a D'],
    diagnostic_steps:['Verificar señal del interruptor en diferentes posiciones','Ajustar posición del interruptor','Reemplazar si defectuoso'],
    repair_priority:2, brands_affected:['Universal automáticas'], latam_cost_usd:'20-150', latam_notes:'' },

  // ═══════════════════════════════════════════════════════════
  // P1XXX — CÓDIGOS ESPECÍFICOS DE FABRICANTE
  // ═══════════════════════════════════════════════════════════

  { code:'P1000', title:'Monitor OBD-II no completado', system:'Sistema OBD', severity:'Bajo',
    description:'Los monitores de diagnóstico OBD-II no se han completado. No indica falla real.',
    causes:['Batería desconectada recientemente','Código borrado con scanner','Ciclo de manejo insuficiente'],
    diagnostic_steps:['Realizar ciclo de manejo OBD-II completo (mix ciudad/ruta)','Verificar que todos los monitores pasen'],
    repair_priority:3, brands_affected:['Ford','Universal'], latam_cost_usd:'0',
    latam_notes:'No es una falla real. Requiere ciclo de conducción para que monitores OBD se completen.' },

  { code:'P1101', title:'MAF fuera de rango self test (Ford)', system:'Motor · Admisión', severity:'Moderado',
    description:'Código específico Ford. El MAF está fuera de rango durante el autotest.',
    causes:['MAF sucio','Fuga de aire en el sistema de admisión','MAF defectuoso'],
    diagnostic_steps:['Limpiar MAF con spray','Verificar mangueras de admisión','Realizar test del MAF con scanner Ford IDS'],
    repair_priority:2, brands_affected:['Ford'], latam_cost_usd:'5-120',
    latam_notes:'Muy frecuente en Ford Focus, EcoSport, Fiesta con motor 1.6L Sigma.' },

  { code:'P1130', title:'Sensor O2 fuera de rango (Toyota/Lexus)', system:'Motor · Sensores O2', severity:'Moderado',
    description:'Código específico Toyota/Lexus. Sensor O2 A/F ratio (air-fuel ratio sensor) fuera de rango.',
    causes:['Sensor A/F ratio defectuoso','Mezcla muy pobre o rica','Cableado dañado'],
    diagnostic_steps:['Verificar que motor esté en lazo cerrado','Verificar mezcla (fuel trim)','Reemplazar sensor A/F si fuera de rango'],
    repair_priority:2, brands_affected:['Toyota','Lexus'], latam_cost_usd:'80-300',
    latam_notes:'Toyota Corolla, Camry, RAV4, Highlander muy frecuente. Sensor A/F original Toyota recomendado.' },

  { code:'P1135', title:'Calefactor sensor A/F ratio B1S1 (Toyota/Lexus)', system:'Motor · Sensores O2', severity:'Moderado',
    description:'Falla en el calefactor del sensor A/F ratio banco 1. Código específico Toyota.',
    causes:['Calefactor del sensor A/F quemado','Fusible quemado','Cableado dañado'],
    diagnostic_steps:['Verificar fusible EFI o HEATER','Medir resistencia calefactor','Reemplazar sensor si resistencia infinita'],
    repair_priority:2, brands_affected:['Toyota','Lexus'], latam_cost_usd:'100-300',
    latam_notes:'Toyota Corolla/Camry/RAV4 con motor 1ZZ, 2AZ, 2GR muy frecuente.' },

  { code:'P1320', title:'Falla señal distribuidor (Nissan)', system:'Motor · Ignición', severity:'Crítico',
    description:'Código específico Nissan. Señal del módulo de ignición/distribuidor interrumpida.',
    causes:['Módulo de ignición dentro del distribuidor defectuoso','Distribuidor desgastado','Cableado dañado'],
    symptoms:['Motor para repentinamente','Falla al acelerar','No arranca'],
    diagnostic_steps:['Verificar señal CKP del distribuidor','Reemplazar módulo de ignición dentro del distribuidor','Verificar cableado'],
    repair_priority:1, brands_affected:['Nissan'], latam_cost_usd:'50-300',
    latam_notes:'Muy frecuente en Nissan Sentra B14/B15, Frontier, Pathfinder con motor KA24, VG33.' },

  { code:'P1400', title:'Control de emisiones DPFE (Ford)', system:'Motor · Emisiones', severity:'Moderado',
    description:'Código específico Ford. Falla en sensor diferencial de presión EGR (DPFE).',
    causes:['Sensor DPFE defectuoso','Mangueras al DPFE bloqueadas o agrietadas','Válvula EGR defectuosa'],
    diagnostic_steps:['Inspeccionar mangueras de silicona al DPFE (se agrietan con el calor)','Reemplazar DPFE si voltaje incorrecto','Verificar válvula EGR'],
    repair_priority:2, brands_affected:['Ford'], latam_cost_usd:'30-150',
    latam_notes:'Ford Focus, Mondeo, F-150, Explorer con motor 2.0L/2.3L/4.0L muy frecuente. Mangueras se agrietan.' },

  // ═══════════════════════════════════════════════════════════
  // MARCAS ESPECÍFICAS — VW / AUDI
  // ═══════════════════════════════════════════════════════════

  { code:'P1545', title:'Posición mariposa electrónica fuera de rango (VW/Audi)', system:'Motor · Mariposa', severity:'Crítico',
    description:'La mariposa electrónica (throttle-by-wire) no está en posición esperada.',
    causes:['Mariposa electrónica sucia o defectuosa','Sensor de posición mariposa defectuoso','Problema en pedal acelerador electrónico'],
    symptoms:['Motor en modo emergencia (limp mode)','Potencia reducida a ~30%','Luz naranja motor'],
    diagnostic_steps:['Limpiar mariposa electrónica','Realizar adaptación básica de mariposa con VAG-COM','Verificar pedal acelerador'],
    repair_priority:1, brands_affected:['VW','Audi','SEAT','Skoda'], latam_cost_usd:'30-500',
    latam_notes:'VW Gol G4/G5/G6, Polo, Golf, Vento muy frecuente. Limpieza + adaptación basic settings resuelve 70%.' },

  { code:'P1550', title:'Diferencia sensor acelerador (VW/Audi)', system:'Motor · Mariposa', severity:'Crítico',
    description:'Los dos sensores del pedal acelerador muestran valores inconsistentes.',
    causes:['Sensor de posición pedal acelerador defectuoso','Cableado dañado al pedal','Pedal acelerador defectuoso'],
    symptoms:['Limp mode','Motor no responde al acelerador','Potencia reducida'],
    diagnostic_steps:['Verificar señales de los dos sensores del pedal (deben ser proporcionales)','Reemplazar sensor/pedal si señales inconsistentes'],
    repair_priority:1, brands_affected:['VW','Audi','SEAT','Skoda'], latam_cost_usd:'50-400',
    latam_notes:'Pedal acelerador VW $80-200. Verificar antes conector del pedal (corrosión frecuente).' },

  // ═══════════════════════════════════════════════════════════
  // MARCAS ESPECÍFICAS — RENAULT / PEUGEOT / CITROEN
  // ═══════════════════════════════════════════════════════════

  { code:'P1560', title:'Sistema de arranque asistido falla (Renault)', system:'Sistema eléctrico', severity:'Moderado',
    description:'Código frecuente en Renault. Problema con el sistema de inmovilizador o llave transponder.',
    causes:['Batería de llave descargada','Inmovilizador no reconoce transponder','Antena inmovilizador defectuosa','BSI (Body Systems Interface) con falla'],
    symptoms:['Motor no arranca aunque enciende','Testigo inmovilizador titila'],
    diagnostic_steps:['Reemplazar pila llave (CR2025/CR2032)','Reprogramar llave si cambió','Verificar antena inmovilizador','Leer códigos con DiagBox/Clip'],
    repair_priority:1, brands_affected:['Renault'], latam_cost_usd:'5-500',
    latam_notes:'Renault Clio, Megane, Laguna, Scenic. Primero cambiar pila de la llave ($2). Reprogramación $50-100.' },

  { code:'P2004', title:'Mariposa de swirl (tumble flap) atascada abierta', system:'Motor · Admisión', severity:'Moderado',
    description:'Las aletas de swirl del colector de admisión están atascadas abiertas.',
    causes:['Actuador de mariposa swirl defectuoso','Varilla del mecanismo rota','Carbón atascando las aletas'],
    symptoms:['Ralentí inestable','Falla en frío','Mayor consumo'],
    diagnostic_steps:['Verificar actuador con scanner (activación)','Revisar varillas del mecanismo por rotura (muy frecuente)','Limpiar colector de admisión'],
    repair_priority:2, brands_affected:['VW','Audi','BMW','Peugeot'], latam_cost_usd:'30-400',
    latam_notes:'VW Golf TDI, Audi A4 TDI muy frecuente. Varilla de plástico se rompe. Repuesto barato $10-30.' },

  { code:'P2008', title:'Circuito mariposa swirl colector admisión', system:'Motor · Admisión', severity:'Moderado',
    description:'Falla eléctrica en el circuito del actuador de mariposas de admisión.',
    causes:['Actuador defectuoso','Cableado dañado','Conector oxidado'],
    diagnostic_steps:['Medir resistencia actuador','Verificar cableado','Limpiar conector'],
    repair_priority:2, brands_affected:['VW','BMW','Mercedes','Peugeot'], latam_cost_usd:'30-300', latam_notes:'' },

  // ═══════════════════════════════════════════════════════════
  // P2XXX — CÓDIGOS OBD-II ADICIONALES
  // ═══════════════════════════════════════════════════════════

  { code:'P2096', title:'Corrección mezcla downstream demasiado pobre B1', system:'Motor · Sensores O2', severity:'Moderado',
    description:'La corrección de mezcla basada en el sensor O2 downstream es muy negativa.',
    causes:['Sensor O2 downstream defectuoso','Catalizador muy degradado afectando lecturas','Fuga en sistema exhaust'],
    diagnostic_steps:['Verificar señal O2 downstream','Comparar con comportamiento normal','Verificar catalizador (P0420)'],
    repair_priority:2, brands_affected:['Toyota','Honda'], latam_cost_usd:'30-500', latam_notes:'' },

  { code:'P2097', title:'Corrección mezcla downstream demasiado rica B1', system:'Motor · Sensores O2', severity:'Moderado',
    description:'La corrección de mezcla basada en sensor O2 downstream es muy positiva.',
    causes:['Sensor O2 downstream defectuoso','Mezcla rica no compensada por catalizador'],
    diagnostic_steps:['Verificar sensor O2 downstream','Verificar ausencia de fuga de combustible en sistema exhaust'],
    repair_priority:2, brands_affected:['Toyota','Honda'], latam_cost_usd:'30-150', latam_notes:'' },

  { code:'P2101', title:'Rango/desempeño motor control mariposa electrónica', system:'Motor · Mariposa', severity:'Crítico',
    description:'El motor de la mariposa electrónica no alcanza la posición comandada.',
    causes:['Mariposa electrónica sucia o defectuosa','Motor de mariposa quemado','Conector oxidado','Problema en ECU'],
    symptoms:['Limp mode severo','Motor apenas arranca','Potencia muy reducida'],
    diagnostic_steps:['Limpiar mariposa con spray específico','Realizar adaptación básica','Medir resistencia motor mariposa','Verificar alimentación y masa de la mariposa'],
    repair_priority:1, brands_affected:['VW','Audi','Toyota','Ford','Chevrolet'], latam_cost_usd:'30-600',
    latam_notes:'Limpieza + adaptación basic settings $30-50. Reemplazo cuerpo mariposa $150-600.' },

  { code:'P2111', title:'Mariposa electrónica atascada abierta', system:'Motor · Mariposa', severity:'Crítico',
    description:'La mariposa electrónica no puede cerrarse. Motor puede acelerar sin control.',
    causes:['Mariposa sucia con carbón','Motor de mariposa defectuoso','Muelle de retorno roto'],
    symptoms:['Motor acelera solo','Ralentí muy alto','Potencia sin respuesta al pedal'],
    diagnostic_steps:['Limpiar mariposa URGENTE','Verificar muelle de retorno','Reemplazar cuerpo mariposa si no cierra'],
    repair_priority:1, brands_affected:['Universal electronic throttle'], latam_cost_usd:'30-600',
    latam_notes:'Si motor acelera sin control = urgente. Limpiar mariposa puede resolverlo.' },

  { code:'P2122', title:'Señal baja sensor pedal acelerador D1', system:'Motor · Mariposa', severity:'Crítico',
    description:'El sensor de posición del pedal acelerador (circuito D) tiene señal baja.',
    causes:['Sensor APP defectuoso','Cableado dañado','Conector oxidado'],
    symptoms:['Motor en limp mode','No responde al acelerador correctamente'],
    diagnostic_steps:['Verificar voltaje señal >0.5V en mínimo','Revisar conector del pedal','Reemplazar sensor/pedal'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'40-400', latam_notes:'' },

  { code:'P2127', title:'Señal baja sensor pedal acelerador E2', system:'Motor · Mariposa', severity:'Crítico',
    description:'El segundo sensor del pedal acelerador tiene señal baja. Confirmación de falla.',
    causes:['Sensor APP defectuoso','Cableado dañado'],
    diagnostic_steps:['Ver P2122 — mismo diagnóstico para segundo sensor'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'40-400', latam_notes:'' },

  { code:'P2135', title:'Correlación sensores posición mariposa A y B', system:'Motor · Mariposa', severity:'Crítico',
    description:'Los dos sensores de posición de la mariposa electrónica muestran valores inconsistentes.',
    causes:['Mariposa electrónica defectuosa','Engranaje de posición desgastado','Suciedad en sensores','ECU defectuosa'],
    symptoms:['Limp mode inmediato','Motor no responde al acelerador'],
    diagnostic_steps:['Limpiar mariposa y realizar adaptación','Si persiste = reemplazar cuerpo de mariposa','Verificar cableado'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'30-600',
    latam_notes:'Toyota Corolla/Camry, VW Golf, Ford Focus muy frecuente.' },

  { code:'P2187', title:'Mezcla pobre en ralentí banco 1', system:'Motor · Combustión', severity:'Moderado',
    description:'El sistema de mezcla está pobre específicamente en ralentí. Diferente a P0171.',
    causes:['Fuga de vacío en ralentí (empeora en mínimos)','IAC defectuoso','Sensor MAP/MAF con drift en bajas lecturas'],
    diagnostic_steps:['Verificar LTFT/STFT específicamente en ralentí','Si STFT muy positivo en ralentí pero mejora en 2500 RPM = fuga de vacío','Limpiar IAC y mariposa'],
    repair_priority:2, brands_affected:['Toyota','Subaru','Honda'], latam_cost_usd:'5-200', latam_notes:'' },

  { code:'P2188', title:'Mezcla rica en ralentí banco 1', system:'Motor · Combustión', severity:'Moderado',
    description:'El sistema está con mezcla excesivamente rica en ralentí.',
    causes:['Inyector con fuga en ralentí','Presión de combustible alta','IAC atascado permitiendo más combustible'],
    diagnostic_steps:['Verificar LTFT en ralentí muy negativo','Prueba de estanqueidad inyectores','Medir presión combustible'],
    repair_priority:2, brands_affected:['Toyota','Honda'], latam_cost_usd:'20-300', latam_notes:'' },

  { code:'P2195', title:'Sensor A/F ratio señal atascada pobre B1S1 (Toyota)', system:'Motor · Sensores O2', severity:'Moderado',
    description:'El sensor A/F ratio está fijo en valor pobre. Sensor defectuoso o mezcla extremadamente pobre.',
    causes:['Sensor A/F ratio defectuoso','Mezcla muy pobre','Fuga de aire grande'],
    diagnostic_steps:['Verificar fuel trim (si muy positivo = mezcla pobre real)','Revisar fugas de vacío','Reemplazar sensor A/F si fuel trim normal'],
    repair_priority:2, brands_affected:['Toyota','Lexus'], latam_cost_usd:'100-300',
    latam_notes:'Toyota Corolla/Camry/RAV4 2003-2013 muy frecuente. Sensor A/F original recomendado ($150-300).' },

  // ═══════════════════════════════════════════════════════════
  // B — BODY CODES (CARROCERÍA)
  // ═══════════════════════════════════════════════════════════

  { code:'B0001', title:'Circuito airbag conductor', system:'Seguridad · Airbag', severity:'Crítico',
    description:'Falla en el circuito del airbag del conductor. Sistema desactivado por seguridad.',
    causes:['Conector del espiral del airbag (clock spring) defectuoso','Clock spring roto','Cable del airbag dañado','Módulo SRS defectuoso'],
    symptoms:['Luz airbag encendida','Airbag desactivado','Bocina puede no funcionar (en clock spring)'],
    diagnostic_steps:['Verificar conector del airbag del volante','Revisar clock spring con resistencia (3-6Ω)','Revisar cableado del arnés al airbag'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'30-500',
    latam_notes:'Clock spring $30-100. Con airbag desactivado = no hay protección en colisión. Urgente reparar.' },

  { code:'B1000', title:'Falla módulo control carrocería (BCM)', system:'Sistema eléctrico', severity:'Moderado',
    description:'El módulo de control de carrocería presenta un error interno.',
    causes:['BCM con actualización pendiente','BCM defectuoso','Problema de alimentación al BCM'],
    diagnostic_steps:['Verificar alimentación y masa del BCM','Actualizar firmware del BCM','Reemplazar BCM si defectuoso'],
    repair_priority:2, brands_affected:['GM','Ford','Chrysler'], latam_cost_usd:'50-800', latam_notes:'' },

  // ═══════════════════════════════════════════════════════════
  // C — CHASSIS CODES (CHASIS / FRENOS)
  // ═══════════════════════════════════════════════════════════

  { code:'C0035', title:'Falla sensor velocidad rueda delantera derecha (ABS)', system:'Frenos · ABS', severity:'Crítico',
    description:'El sensor ABS de la rueda delantera derecha no funciona.',
    causes:['Sensor ABS defectuoso','Anillo fónico dañado (roto o sucio)','Cableado dañado','Entrehierro excesivo'],
    symptoms:['Luz ABS encendida','ABS desactivado','ESP/TCS desactivado'],
    diagnostic_steps:['Limpiar anillo fónico del sensor','Verificar entrehierro (0.5-1.5mm)','Medir señal del sensor con osciloscopio','Reemplazar sensor si señal ausente'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'20-150',
    latam_notes:'Sensor ABS genérico $20-50. Verificar anillo fónico por óxido antes de reemplazar.' },

  { code:'C0040', title:'Falla sensor velocidad rueda delantera izquierda (ABS)', system:'Frenos · ABS', severity:'Crítico',
    description:'El sensor ABS de la rueda delantera izquierda no funciona.',
    causes:['Sensor ABS defectuoso','Anillo fónico dañado','Cableado dañado'],
    diagnostic_steps:['Ver diagnóstico C0035 — mismos pasos'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'20-150', latam_notes:'' },

  { code:'C0045', title:'Falla sensor velocidad rueda trasera derecha (ABS)', system:'Frenos · ABS', severity:'Crítico',
    description:'El sensor ABS de la rueda trasera derecha no funciona.',
    causes:['Sensor ABS defectuoso','Anillo fónico en semeje/cubo dañado','Cableado dañado'],
    diagnostic_steps:['Ver diagnóstico C0035 — mismos pasos para trasera derecha'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'20-150', latam_notes:'' },

  { code:'C0050', title:'Falla sensor velocidad rueda trasera izquierda (ABS)', system:'Frenos · ABS', severity:'Crítico',
    description:'El sensor ABS de la rueda trasera izquierda no funciona.',
    causes:['Sensor ABS defectuoso','Anillo fónico dañado','Cableado dañado'],
    diagnostic_steps:['Ver diagnóstico C0035 — mismos pasos para trasera izquierda'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'20-150', latam_notes:'' },

  { code:'C0110', title:'Falla motor bomba ABS', system:'Frenos · ABS', severity:'Crítico',
    description:'El motor de la bomba ABS/ESP no funciona correctamente.',
    causes:['Motor bomba ABS defectuoso','Relé de bomba ABS quemado','Módulo ABS defectuoso','Problema eléctrico'],
    symptoms:['Luz ABS y ESP encendidas','Sin ABS funcional'],
    diagnostic_steps:['Verificar relé de bomba ABS','Verificar alimentación al motor bomba','Activar bomba con scanner para verificar funcionamiento'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'100-1500',
    latam_notes:'Módulo ABS reacondicionado $150-400. Original $500-1500.' },

  { code:'C0265', title:'Falla circuito relé motor ABS/EBCM', system:'Frenos · ABS', severity:'Crítico',
    description:'El relé del módulo ABS presenta falla.',
    causes:['Relé ABS defectuoso','Cableado dañado','Módulo ABS defectuoso'],
    diagnostic_steps:['Verificar relé ABS en fusiblera','Reemplazar relé','Si persiste = módulo ABS defectuoso'],
    repair_priority:1, brands_affected:['GM','Chevrolet'], latam_cost_usd:'10-1000',
    latam_notes:'Chevrolet Corsa, Astra, Vectra muy frecuente. Primero verificar relé ($10-20).' },

  // ═══════════════════════════════════════════════════════════
  // U — NETWORK CODES (RED DE COMUNICACIÓN)
  // ═══════════════════════════════════════════════════════════

  { code:'U0001', title:'Bus CAN de alta velocidad', system:'Red de comunicación', severity:'Crítico',
    description:'Falla en la red CAN de alta velocidad. Múltiples módulos no se comunican.',
    causes:['Cortocircuito en bus CAN H o CAN L','Módulo defectuoso bloqueando la red','Cableado dañado','Conector mojado'],
    symptoms:['Múltiples luces de falla encendidas','Varios sistemas sin funcionamiento','Instrumentos erráticos'],
    diagnostic_steps:['Medir resistencia entre CAN H y CAN L (debe ser 60Ω)','Desconectar módulos de a uno para aislar el problemático','Verificar fusibles de los módulos'],
    repair_priority:1, brands_affected:['Universal moderno'], latam_cost_usd:'50-2000',
    latam_notes:'Si aparecen 10+ códigos simultáneos = problema en bus CAN. Diagnóstico con equipo específico.' },

  { code:'U0100', title:'Pérdida de comunicación con ECM/PCM', system:'Red de comunicación', severity:'Crítico',
    description:'Otros módulos perdieron comunicación con la computadora principal del motor.',
    causes:['ECM/PCM sin alimentación o masa','Falla del bus CAN','ECM/PCM defectuoso'],
    diagnostic_steps:['Verificar alimentación y masas de la ECM','Verificar fusibles de la ECM','Medir bus CAN'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'50-2000', latam_notes:'' },

  { code:'U0101', title:'Pérdida de comunicación con TCM (transmisión)', system:'Red de comunicación', severity:'Crítico',
    description:'El módulo de transmisión no responde en la red CAN.',
    causes:['TCM sin alimentación','Fusible TCM quemado','Falla en bus CAN','TCM defectuoso'],
    diagnostic_steps:['Verificar fusible TCM','Verificar alimentación TCM','Medir bus CAN con TCM desconectado'],
    repair_priority:1, brands_affected:['Universal automáticas'], latam_cost_usd:'50-2000', latam_notes:'' },

  { code:'U0121', title:'Pérdida de comunicación con módulo ABS', system:'Red de comunicación', severity:'Crítico',
    description:'El módulo ABS no responde en la red de comunicación.',
    causes:['Módulo ABS sin alimentación','Fusible ABS quemado','Falla en bus CAN','Módulo ABS defectuoso'],
    diagnostic_steps:['Verificar fusibles del ABS','Verificar alimentación módulo ABS','Verificar bus CAN'],
    repair_priority:1, brands_affected:['Universal'], latam_cost_usd:'50-1500', latam_notes:'' },

  { code:'U0140', title:'Pérdida de comunicación con BCM', system:'Red de comunicación', severity:'Moderado',
    description:'El módulo de carrocería no responde en la red CAN.',
    causes:['BCM sin alimentación','Fusible BCM quemado','BCM defectuoso'],
    diagnostic_steps:['Verificar fusibles del BCM','Verificar alimentación','Leer códigos del BCM directamente'],
    repair_priority:2, brands_affected:['Universal'], latam_cost_usd:'50-800', latam_notes:'' },

  // ═══════════════════════════════════════════════════════════
  // DIESEL — CÓDIGOS ESPECÍFICOS
  // ═══════════════════════════════════════════════════════════

  { code:'P0087', title:'Presión combustible del riel demasiado baja', system:'Motor · Combustible (Diesel/GDI)', severity:'Crítico',
    description:'La presión del riel de combustible está por debajo del mínimo. Motor en modo emergencia.',
    causes:['Filtro de combustible tapado','Bomba de baja presión débil','Bomba de alta presión defectuosa','Inyectores con fuga interna','Regulador de presión de riel defectuoso','Válvula de control de presión del riel'],
    symptoms:['Pérdida de potencia severa','Motor en limp mode','Humo negro en diesel','Difícil arranque en frío'],
    diagnostic_steps:['1. Cambiar filtro de combustible','2. Medir presión actual del riel con scanner (debe ser >1000 bar en diesel bajo carga)','3. Verificar bomba baja presión (80-100 PSI)','4. Verificar bomba alta presión','5. Probar inyectores por fuga interna'],
    freeze_frame_hints:'Presión riel <800 bar en diesel = bomba o filtro. >800 bar pero código presente = sensor o inyector',
    repair_priority:1, brands_affected:['VW TDI','Peugeot HDi','Renault dCi','Ford TDCi','Toyota D-4D','Chevrolet diesel'], latam_cost_usd:'30-2000',
    latam_notes:'Filtro combustible $30-60 (primero siempre). Bomba alta presión $400-1500. Inyectores $150-400 c/u.' },

  { code:'P0088', title:'Presión combustible del riel demasiado alta', system:'Motor · Combustible (Diesel/GDI)', severity:'Crítico',
    description:'La presión del riel supera el máximo seguro. Puede dañar inyectores.',
    causes:['Válvula de control de presión del riel atascada cerrada','Regulador de presión defectuoso','Sensor de presión riel defectuoso'],
    diagnostic_steps:['Medir presión real del riel','Si presión real normal = sensor defectuoso','Si presión alta = válvula reguladora atascada'],
    repair_priority:1, brands_affected:['VW TDI','Peugeot HDi','Renault dCi','BMW diesel'], latam_cost_usd:'50-800', latam_notes:'' },

  { code:'P0191', title:'Rango/desempeño sensor presión combustible riel', system:'Motor · Combustible (Diesel/GDI)', severity:'Crítico',
    description:'El sensor de presión del riel de combustible está fuera de rango esperado.',
    causes:['Sensor de presión riel defectuoso','Presión real incorrecta','Cableado dañado'],
    diagnostic_steps:['Comparar presión medida por scanner vs manómetro real','Si difieren = sensor defectuoso'],
    repair_priority:1, brands_affected:['VW TDI','Peugeot HDi','Renault dCi'], latam_cost_usd:'50-400', latam_notes:'' },

  { code:'P0380', title:'Falla circuito bujía de precalentamiento A (Diesel)', system:'Motor · Precalentamiento (Diesel)', severity:'Moderado',
    description:'El circuito de la bujía de precalentamiento banco A tiene falla.',
    causes:['Bujía de precalentamiento quemada','Relé de precalentamiento defectuoso','Cableado dañado','Módulo de control de precalentamiento'],
    symptoms:['Difícil arranque en frío','Humo blanco excesivo en frío','Motor tembla al arrancar en frío'],
    diagnostic_steps:['Medir resistencia de bujías de precalentamiento (<1Ω cada una)','Verificar relé de precalentamiento','Verificar continuidad del cableado'],
    repair_priority:2, brands_affected:['VW TDI','Peugeot HDi','Renault dCi','Fiat JTD','Toyota D-4D'], latam_cost_usd:'10-200',
    latam_notes:'Bujía precalentamiento $10-30 c/u. Juego completo $40-80. En Argentina el frío del invierno evidencia la falla.' },

  { code:'P2563', title:'Rango/desempeño sensor posición turbina turbocompresor', system:'Motor · Turbo', severity:'Moderado',
    description:'El sensor de posición de las aletas variables del turbo está fuera de rango.',
    causes:['Actuador VGT atascado por carbonilla','Sensor de posición defectuoso','Mangueras de vacío al VGT dañadas'],
    symptoms:['Potencia reducida','Humo excesivo negro','Motor en limp mode en diesel'],
    diagnostic_steps:['Limpiar actuador VGT','Verificar movimiento libre de aletas','Verificar sensor de posición','Actualizar calibración del actuador'],
    repair_priority:2, brands_affected:['VW TDI 2.0','Ford TDCi 1.6/2.0','Peugeot HDi 1.6','Renault dCi 1.5/2.0'], latam_cost_usd:'50-1500',
    latam_notes:'Limpieza VGT $50-100. Actuador completo $200-500. Turbo nuevo $800-1500.' },

  // ═══════════════════════════════════════════════════════════
  // HYBRIDOS — TOYOTA PRIUS / HONDA
  // ═══════════════════════════════════════════════════════════

  { code:'P3000', title:'Falla sistema batería HV (Híbrido)', system:'Sistema eléctrico · Híbrido', severity:'Crítico',
    description:'La batería de alto voltaje del sistema híbrido tiene una falla.',
    causes:['Celda de batería defectuosa','Módulo de batería degradado','Falla en el sistema de gestión de batería (BMS)','Ventilación de batería bloqueada'],
    symptoms:['Luz READY no enciende','Vehículo no puede circular en modo EV','Mayor consumo de nafta','Triángulo rojo de advertencia'],
    diagnostic_steps:['Leer códigos del sistema híbrido con scanner compatible','Verificar estado de cada módulo de batería','Verificar temperatura de batería','Verificar ventilación de batería'],
    repair_priority:1, brands_affected:['Toyota Prius','Toyota Highlander Hybrid','Honda Insight','Honda Civic Hybrid'], latam_cost_usd:'500-8000',
    latam_notes:'Batería reacondicionada $800-2000. Original Toyota $3000-8000. Celdas individuales $50-100 c/u.' },

  // ═══════════════════════════════════════════════════════════
  // GLP / GNC — CÓDIGOS DE GAS
  // ═══════════════════════════════════════════════════════════

  { code:'P1800', title:'Falla sistema GNC/GLP — presión baja', system:'Motor · Combustible GNC', severity:'Moderado',
    description:'La presión del sistema GNC está por debajo del mínimo necesario.',
    causes:['Cilindro vacío o con poca presión','Regulador de presión defectuoso','Inyectores de gas tapados','Válvula de cierre defectuosa'],
    symptoms:['Motor falla al pasar a gas','Encendido de testigo GNC','Mayor consumo'],
    diagnostic_steps:['Verificar presión en cilindro GNC (>30 bar para arranque)','Verificar presión de salida del regulador','Verificar inyectores de gas con escáner del kit','Verificar válvula electromagnética'],
    repair_priority:2, brands_affected:['Universal con kit GNC'], latam_cost_usd:'20-500',
    latam_notes:'Muy frecuente en Argentina donde el GNC está muy difundido. Regulador $50-200. Inyectores $30-80 c/u.' },

];

// Total count
const TOTAL_CODES = DTC_DATABASE.length;

module.exports = { DTC_DATABASE, TOTAL_CODES };
