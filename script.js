document.addEventListener('DOMContentLoaded', () => {
    // IMPORTANTE: Após hospedar o backend no Render, substitua a URL abaixo
    // pela URL que o Render fornecer para a sua API.
    const API_URL = 'https://salc.onrender.com'; // <-- SUBSTITUA AQUI

    // Seletores do DOM
    const totalNotasEl = document.getElementById('total-notas');
    const totalValorEl = document.getElementById('total-valor');
    const totalRestanteEl = document.getElementById('total-restante');
    const totalEmpenhosEl = document.getElementById('total-empenhos');
    const notasTableBody = document.querySelector('#notas-table tbody');
    const empenhosTableBody = document.querySelector('#empenhos-table tbody');
    const notaForm = document.getElementById('nota-form');
    const empenhoForm = document.getElementById('empenho-form');
    const tabs = document.querySelectorAll('.tab-btn');
    const contentSections = document.querySelectorAll('.content-section');

    // Funções Utilitárias
    const formatCurrency = (value) => `R$ ${parseFloat(value).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
    const formatDate = (dateString) => new Date(dateString + 'T00:00:00').toLocaleDateString('pt-BR');

    // Funções da API
    const apiRequest = async (endpoint, method = 'GET', body = null) => {
        const options = {
            method,
            headers: { 'Content-Type': 'application/json' },
        };
        if (body) options.body = JSON.stringify(body);
        
        try {
            const response = await fetch(`${API_URL}/${endpoint}`, options);
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Erro na requisição');
            }
            if (response.status === 204) return null; // No Content
            return response.json();
        } catch (error) {
            alert(`Erro de comunicação com o servidor: ${error.message}`);
            console.error(`Falha na requisição para ${endpoint}:`, error);
            throw error;
        }
    };

    // Lógica de Carregamento de Dados
    const loadNotas = async () => {
        try {
            const notas = await apiRequest('notas');
            notasTableBody.innerHTML = '';
            notas.forEach(n => {
                const row = notasTableBody.insertRow();
                row.innerHTML = `
                    <td>${n.numero}</td>
                    <td>${formatCurrency(n.valor)}</td>
                    <td>${formatCurrency(n.valor_restante)}</td>
                    <td>${formatDate(n.prazo)}</td>
                    <td class="action-buttons">
                        <button class="delete-btn" data-type="notas" data-id="${n.numero}"><i class="fas fa-trash-alt"></i></button>
                    </td>
                `;
            });
            updateDashboard();
        } catch (e) { /* erro já tratado em apiRequest */ }
    };

    const loadEmpenhos = async () => {
        try {
            const empenhos = await apiRequest('empenhos');
            empenhosTableBody.innerHTML = '';
            empenhos.forEach(e => {
                const row = empenhosTableBody.insertRow();
                row.innerHTML = `
                    <td>${e.numero}</td>
                    <td>${e.numero_nota}</td>
                    <td>${formatCurrency(e.valor)}</td>
                    <td>${formatDate(e.data)}</td>
                    <td class="action-buttons">
                        <button class="delete-btn" data-type="empenhos" data-id="${e.numero}"><i class="fas fa-trash-alt"></i></button>
                    </td>
                `;
            });
            updateDashboard();
        } catch (e) { /* erro já tratado em apiRequest */ }
    };
    
    const updateDashboard = async () => {
        try {
            const [notas, empenhos] = await Promise.all([apiRequest('notas'), apiRequest('empenhos')]);
            totalNotasEl.textContent = notas.length;
            totalEmpenhosEl.textContent = empenhos.length;
            const totalValor = notas.reduce((sum, n) => sum + n.valor, 0);
            const totalRestante = notas.reduce((sum, n) => sum + n.valor_restante, 0);
            totalValorEl.textContent = formatCurrency(totalValor);
            totalRestanteEl.textContent = formatCurrency(totalRestante);
        } catch (e) { /* erro já tratado em apiRequest */ }
    };

    // Lógica de Formulários e Eventos
    const handleFormSubmit = async (event, endpoint, callback) => {
        event.preventDefault();
        const form = event.target;
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;

        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());

        if (data.valor) data.valor = parseFloat(data.valor);
        
        try {
            await apiRequest(endpoint, 'POST', data);
            form.reset();
            if (callback) await callback();
        } finally {
            button.disabled = false;
        }
    };
    
    notaForm.addEventListener('submit', (e) => handleFormSubmit(e, 'notas', loadNotas));
    empenhoForm.addEventListener('submit', (e) => handleFormSubmit(e, 'empenhos', loadEmpenhos));

    document.body.addEventListener('click', async (event) => {
        const target = event.target.closest('.delete-btn');
        if (!target) return;
        
        const { type, id } = target.dataset;
        if (confirm(`Tem certeza que deseja deletar o registro ${id}?`)) {
            await apiRequest(`${type}/${id}`, 'DELETE');
            if (type === 'notas') await loadNotas();
            if (type === 'empenhos') await loadEmpenhos();
        }
    });

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            const targetId = tab.getAttribute('data-tab');
            contentSections.forEach(section => {
                section.classList.toggle('active', section.id === targetId);
            });
        });
    });

    // Carga Inicial
    loadNotas();
    loadEmpenhos();

});
