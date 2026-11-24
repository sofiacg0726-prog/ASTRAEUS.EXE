/* ===========================================================
   ASTRAEUS — IMPULSO JOVEN
   Calculadora independiente del simulador hipotecario principal.

   FUNDAMENTO ACADÉMICO (Documento preliminar Impulso Joven):
     Tasa nominal fija 5% anual, convertible mensualmente.
     Pagos vencidos, iguales en cada bloque de 12 meses.
     La mensualidad aumenta 3% al comenzar cada año.
     Crédito máximo preliminar: $1,000,000.
     Límite de esfuerzo inicial: 30% del ingreso neto.
     Plazos disponibles: 10, 15, 20, 25 años.
     Escenario salarial base: 2.5% anual.

   SUPUESTO AÑADIDO Y EXPLÍCITO: al calcular el máximo,
   restamos las deudas mensuales del 30% del ingreso.
   Es un criterio conservador propio del prototipo.

   No usamos el PPM ni la tasa Actual/360 del Excel bancario.
   No calculamos CAT: faltan seguros, comisiones y otros gastos.
   =========================================================== */

const ImpulsoJovenFinanzas = (() => {
    "use strict";

    const REGLAS = Object.freeze({
        tasaNominalAnual: 0.05,
        incrementoAnualPago: 0.03,
        esfuerzoInicialMaximo: 0.30,
        topeCredito: 1000000,
        crecimientoSalarialBase: 0.025,
        plazos: [10, 15, 20, 25],
        escenariosSalariales: [0.025, 0.04, 0.06]
    });

    const tasaMensual = REGLAS.tasaNominalAnual / 12;

    /**
     * Valor presente de una anualidad mensual vencida que crece por años:
     * Factor = SUMA(mes=1..n) ((1+g)^floor((mes-1)/12)) / ((1+i)^mes)
     * PV = mensualidadInicial * Factor
     * NO es una anualidad con crecimiento mensual.
     */
    function factorValorPresente(plazoAnios) {
        if (!REGLAS.plazos.includes(plazoAnios)) {
            throw new RangeError("El plazo debe ser 10, 15, 20 o 25 años.");
        }
        const n = plazoAnios * 12;
        let factor = 0;
        for (let mes = 1; mes <= n; mes++) {
            const anio = Math.floor((mes - 1) / 12);
            const pagoRelativo = Math.pow(1 + REGLAS.incrementoAnualPago, anio);
            factor += pagoRelativo / Math.pow(1 + tasaMensual, mes);
        }
        return factor;
    }

    function pagoInicial(capital, plazoAnios) {
        if (!(Number.isFinite(capital) && capital >= 0)) {
            throw new RangeError("El capital no puede ser negativo.");
        }
        return capital / factorValorPresente(plazoAnios);
    }

    /**
     * Determina el máximo según el presupuesto inicial conservador:
     * presupuesto = MAX(0, ingreso*30% - deudasMensuales)
     * capital = MIN(1,000,000, presupuesto * factorValorPresente)
     */
    function capacidad(ingreso, deudasMensuales, plazoAnios) {
        if (!(Number.isFinite(ingreso) && ingreso > 0)) {
            throw new RangeError("Ingresa un ingreso neto mayor a cero.");
        }
        if (!(Number.isFinite(deudasMensuales) && deudasMensuales >= 0)) {
            throw new RangeError("Las otras deudas no pueden ser negativas.");
        }
        const disponible = Math.max(0, ingreso * REGLAS.esfuerzoInicialMaximo - deudasMensuales);
        const maximoFinanciero = disponible * factorValorPresente(plazoAnios);
        return {
            disponible,
            maximoFinanciero,
            creditoMaximo: Math.min(REGLAS.topeCredito, maximoFinanciero)
        };
    }

    /**
     * Amortización mensual, con precisión interna sin redondeos por mes.
     * Interés del mes = saldoInicial * (0.05/12).
     * Pago programado = R1*(1.03)^floor((mes-1)/12).
     * Amortización = Pago - Interés. Saldo siguiente = saldo - capital.
     * En el último pago se liquida cualquier residuo flotante.
     */
    function amortizar(capital, plazoAnios) {
        if (!(Number.isFinite(capital) && capital > 0)) {
            throw new RangeError("El monto de crédito debe ser mayor a cero.");
        }
        const mensualidadInicial = pagoInicial(capital, plazoAnios);
        const totalMeses = plazoAnios * 12;
        const filas = [];
        let saldo = capital;
        let interesesTotales = 0;
        let totalPagos = 0;

        for (let mes = 1; mes <= totalMeses; mes++) {
            const anio = Math.floor((mes - 1) / 12) + 1;
            const saldoInicial = saldo;
            const interes = saldoInicial * tasaMensual;
            const pagoPrevisto = mensualidadInicial * Math.pow(1 + REGLAS.incrementoAnualPago, anio - 1);
            const pago = mes === totalMeses
                ? saldoInicial + interes
                : Math.min(saldoInicial + interes, pagoPrevisto);
            const capitalPagado = pago - interes;
            saldo = Math.max(0, saldoInicial - capitalPagado);

            filas.push({mes, anio, saldoInicial, interes, pago, capital: capitalPagado, saldoFinal: saldo});
            interesesTotales += interes;
            totalPagos += pago;
        }
        return {capitalInicial: capital, plazoAnios, mensualidadInicial, filas, interesesTotales, totalPagos, saldoFinal: saldo};
    }

    function resumirAnios(amortizacion, ingresoInicial, crecimientoSalarial) {
        if (!Number.isFinite(crecimientoSalarial) || crecimientoSalarial < -1) {
            throw new RangeError("El crecimiento salarial no es válido.");
        }
        const salida = [];
        for (let anio = 1; anio <= amortizacion.plazoAnios; anio++) {
            const filas = amortizacion.filas.slice((anio - 1) * 12, anio * 12);
            const ingreso = ingresoInicial * Math.pow(1 + crecimientoSalarial, anio - 1);
            const mensualidad = filas[0].pago;
            salida.push({
                anio,
                ingreso,
                mensualidad,
                esfuerzoHipotecario: ingreso > 0 ? mensualidad / ingreso : 0,
                saldoFinal: filas[filas.length - 1].saldoFinal,
                pagosAnuales: filas.reduce((acc, fila) => acc + fila.pago, 0)
            });
        }
        return salida;
    }

    function compararPlazos(capital, ingreso, deudasMensuales) {
        return REGLAS.plazos.map(plazoAnios => {
            const tabla = amortizar(capital, plazoAnios);
            const disponible = Math.max(0, ingreso * REGLAS.esfuerzoInicialMaximo - deudasMensuales);
            return {
                plazoAnios,
                pagoInicial: tabla.mensualidadInicial,
                interesesTotales: tabla.interesesTotales,
                esfuerzo: tabla.mensualidadInicial / ingreso,
                dentroDePresupuesto: tabla.mensualidadInicial <= disponible + 1e-7
                    && capital <= REGLAS.topeCredito
            };
        });
    }

    function simular({ingreso, deudas, credito, plazo, crecimientoSalarial}) {
        if (!(Number.isFinite(credito) && credito > 0)) {
            throw new RangeError("Ingresa un crédito deseado mayor a cero.");
        }
        if (!REGLAS.escenariosSalariales.includes(crecimientoSalarial)) {
            throw new RangeError("Selecciona un escenario salarial válido.");
        }
        const maximo = capacidad(ingreso, deudas, plazo);
        const amortizacion = amortizar(credito, plazo);
        const evaluacion = credito <= maximo.creditoMaximo + 1e-7;
        const proyeccion = resumirAnios(amortizacion, ingreso, crecimientoSalarial);
        return {
            ...maximo,
            credito,
            ingreso,
            deudas,
            plazo,
            crecimientoSalarial,
            amortizacion,
            proyeccion,
            esCompatible: evaluacion,
            esfuerzoHipotecarioInicial: amortizacion.mensualidadInicial / ingreso,
            esfuerzoTotalInicial: (amortizacion.mensualidadInicial + deudas) / ingreso,
            comparacion: compararPlazos(credito, ingreso, deudas),
            escenarios: REGLAS.escenariosSalariales.map(tasa => ({tasa, anios: resumirAnios(amortizacion, ingreso, tasa)}))
        };
    }

    return {REGLAS, factorValorPresente, pagoInicial, capacidad, amortizar, resumirAnios, compararPlazos, simular};
})();

// Permite probar las matemáticas con Node sin cargar la página.
if (typeof module !== "undefined" && module.exports) {
    module.exports = ImpulsoJovenFinanzas;
}

if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", iniciarInterfazImpulsoJoven);
}

function iniciarInterfazImpulsoJoven() {
    "use strict";
    const porId = id => document.getElementById(id);
    const formulario = porId("ijFormulario");
    if (!formulario) return;

    const mxn = x => new Intl.NumberFormat("es-MX", {style:"currency",currency:"MXN",minimumFractionDigits:2,maximumFractionDigits:2}).format(x);
    const pct = x => new Intl.NumberFormat("es-MX", {style:"percent",minimumFractionDigits:2,maximumFractionDigits:2}).format(x);
    const svgNS = "http://www.w3.org/2000/svg";

    function dibujarGrafica(escenarios, plazo) {
        const svg = porId("ijGrafica");
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        const left = 66, right = 24, top = 19, bottom = 39, width = 780, height = 290;
        const x0 = left, x1 = width - right, y0 = top, y1 = height - bottom;
        const maxDato = Math.max(0.30, ...escenarios.flatMap(e => e.anios.map(a => a.esfuerzoHipotecario)));
        const maxY = Math.max(0.35, Math.ceil(maxDato * 20) / 20);
        const y = v => y1 - (v / maxY) * (y1 - y0);
        const x = anio => x0 + (anio - 1) / Math.max(1, plazo - 1) * (x1 - x0);
        function nodo(tipo, atributos, texto) {
            const el = document.createElementNS(svgNS, tipo);
            for (const [k, v] of Object.entries(atributos)) el.setAttribute(k, String(v));
            if (texto !== undefined) el.textContent = texto;
            svg.appendChild(el);
            return el;
        }
        for (let paso = 0; paso <= 4; paso++) {
            const v = maxY * paso / 4;
            nodo("line", {x1:x0,y1:y(v),x2:x1,y2:y(v),stroke:"#e8edf1","stroke-width":1});
            nodo("text",{x:x0-12,y:y(v)+4,"font-size":11,fill:"#738390","text-anchor":"end"},`${(v*100).toFixed(0)}%`);
        }
        [1,5,10,15,20,25].filter(v => v <= plazo).concat(plazo).filter((v,i,a)=>a.indexOf(v)===i).forEach(anio=>{
            nodo("text",{x:x(anio),y:height-12,"font-size":11,fill:"#738390","text-anchor":"middle"},String(anio));
        });
        // Línea guía del 30% del ingreso.
        nodo("line",{x1:x0,y1:y(.3),x2:x1,y2:y(.3),stroke:"#c1a3a7","stroke-width":1.8,"stroke-dasharray":"6 6"});
        const colores = ["#792741","#255879","#668d83"];
        escenarios.forEach((e,i)=>{
            const d = e.anios.map((a,j)=>(j===0?"M":"L")+x(a.anio).toFixed(2)+" "+y(a.esfuerzoHipotecario).toFixed(2)).join(" ");
            nodo("path",{d,fill:"none",stroke:colores[i],"stroke-width":i===0?3:2.4,"stroke-linejoin":"round","stroke-linecap":"round"});
            e.anios.forEach((a,j)=>{if(j===0 || j===e.anios.length-1 || (j+1)%5===0){
                nodo("circle",{cx:x(a.anio),cy:y(a.esfuerzoHipotecario),r:2.9,fill:colores[i]});
            }});
        });
    }

    function crearFila(celdas, clase="") {
        const tr = document.createElement("tr");
        if (clase) tr.className = clase;
        celdas.forEach(c=>{
            const td=document.createElement("td");
            td.textContent=String(c);
            tr.appendChild(td);
        });
        return tr;
    }

    function actualizarTablaAnual(r) {
        const body = porId("ijAnualBody");
        body.replaceChildren();
        r.proyeccion.forEach(a=>body.appendChild(crearFila([
            a.anio, mxn(a.mensualidad), mxn(a.ingreso), pct(a.esfuerzoHipotecario), mxn(a.saldoFinal)
        ])));
    }

    function actualizarTablaComparativa(r) {
        const body = porId("ijCompararBody");
        body.replaceChildren();
        r.comparacion.forEach(c=>body.appendChild(crearFila([
            `${c.plazoAnios} años`,mxn(c.pagoInicial),mxn(c.interesesTotales),pct(c.esfuerzo),
            c.dentroDePresupuesto ? "Dentro del límite" : "Supera el límite"
        ],c.plazoAnios===r.plazo?"ij-selected":"")));
    }

    function actualizarTablaMensual(r) {
        const body = porId("ijMensualBody");
        body.replaceChildren();
        const frag=document.createDocumentFragment();
        r.amortizacion.filas.forEach(f=>frag.appendChild(crearFila([
            f.mes,f.anio,mxn(f.saldoInicial),mxn(f.interes),mxn(f.pago),mxn(f.capital),mxn(f.saldoFinal)
        ])));
        body.appendChild(frag);
    }

    function mostrarResultados(r) {
        porId("ijMaximo").textContent=mxn(r.creditoMaximo);
        porId("ijInicial").textContent=mxn(r.amortizacion.mensualidadInicial);
        porId("ijIntereses").textContent=mxn(r.amortizacion.interesesTotales);
        porId("ijTotal").textContent=mxn(r.amortizacion.totalPagos);
        porId("ijEsfuerzo").textContent=pct(r.esfuerzoHipotecarioInicial);
        porId("ijPresupuesto").textContent=mxn(r.disponible);
        const estado=porId("ijEstado");
        estado.className="ij-status "+(r.esCompatible?"ij-ok":"ij-warn");
        estado.textContent=r.esCompatible?"Compatible con los supuestos iniciales":"El monto supera el límite propuesto";
        const diagnostico=porId("ijDiagnostico");
        diagnostico.textContent=r.esCompatible
            ? `Para el crédito solicitado de ${mxn(r.credito)}, el pago inicial de ${mxn(r.amortizacion.mensualidadInicial)} no rebasa el presupuesto de ${mxn(r.disponible)} reservado a la hipoteca. El porcentaje inicial destinado a hipoteca y otras deudas juntas sería ${pct(r.esfuerzoTotalInicial)}. Esto no equivale a una autorización crediticia.`
            : `El crédito deseado (${mxn(r.credito)}) supera la capacidad estimada o el tope institucional. Con los supuestos del modelo, el máximo sería ${mxn(r.creditoMaximo)}. La tabla muestra el costo matemático del crédito deseado para que puedas comparar opciones, no una oferta aprobada.`;
        actualizarTablaAnual(r);
        actualizarTablaComparativa(r);
        actualizarTablaMensual(r);
        dibujarGrafica(r.escenarios,r.plazo);
        ["ijResultados","ijProyeccion","ijComparacion","ijAmortizacion"].forEach(id=>porId(id).hidden=false);
        porId("ijResultados").scrollIntoView({behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",block:"start"});
    }

    formulario.addEventListener("submit", evento=>{
        evento.preventDefault();
        const error=porId("ijError");
        error.hidden=true; error.textContent="";
        try {
            const ingreso=Number(porId("ijIngreso").value);
            const deudas=porId("ijDeudas").value.trim()==="" ? 0 : Number(porId("ijDeudas").value);
            const credito=Number(porId("ijMonto").value);
            const plazo=Number(porId("ijPlazo").value);
            const crecimientoSalarial=Number(porId("ijCrecimiento").value);
            if (porId("ijIngreso").value.trim()==="" || porId("ijMonto").value.trim()==="") {
                throw new Error("Completa tu ingreso mensual y el crédito deseado.");
            }
            const r=ImpulsoJovenFinanzas.simular({ingreso,deudas,credito,plazo,crecimientoSalarial});
            mostrarResultados(r);
        } catch(err) {
            error.textContent=err.message || "Revisa los datos capturados.";
            error.hidden=false;
        }
    });
}
