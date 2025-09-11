document.addEventListener('DOMContentLoaded', () => {
    // ========================================================================
    // 1. CONFIGURAÇÃO INICIAL E ESTADO DA APLICAÇÃO
    // ========================================================================
    const API_URL = 'https://sua-api-aqui.onrender.com'; // ATENÇÃO: SUBSTITUA PELA SUA URL REAL
    const accessToken = localStorage.getItem('accessToken');
    let currentUser = null; // Armazenará { username, role, ... }
    
    // Cache de dados para evitar requisições repetidas
    let appState = {
        secoes: [],
        notasCredito: [],
        empenhos: [],
        users: [],
        auditLogs: [],
    };

    // Referências aos elementos principais do DOM
    const appNav = document.getElementById('app-nav');
    const appMain = document.getElementById('app-main');
    const usernameDisplay = document.getElementById('username-display');
    const logoutBtn = document.getElementById('logout-btn');
    const modalContainer = document.getElementById('modal-container');
    const modalTemplate = document.getElementById('modal-template');

    // ========================================================================
    // 2. INICIALIZAÇÃO E AUTENTICAÇÃO
    // ========================================================================
    async function initApp() {
        if (!accessToken) {
            window.location.href = 'login.html';
            return;
        }
        try {
            currentUser = await fetchWithAuth('/users/me');
            renderLayout();
            navigateTo('dashboard'); // A view inicial é o Dashboard
        } catch (error) {
            console.error('Falha na autenticação ou inicialização:', error);
            logout();
        }
    }

    function logout() {
        localStorage.removeItem('accessToken');
        window.location.href = 'login.html';
    }

    // ========================================================================
    // 3. FUNÇÃO AUXILIAR PARA REQUISIÇÕES À API
    // ========================================================================
    async function fetchWithAuth(endpoint, options = {}) {
        const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}`, ...options.headers };
        const response = await fetch(`${API_URL}${endpoint}`, { ...options, headers });

        if (response.status === 401) { logout(); throw new Error('Sessão expirada. Por favor, faça login novamente.'); }
        if (!response.ok) { const d = await response.json(); throw new Error(d.detail || 'Erro na requisição.'); }
        return response.status === 204 ? null : response.json();
    }

    // ========================================================================
    // 4. RENDERIZAÇÃO DO LAYOUT E NAVEGAÇÃO
    // ========================================================================
    function renderLayout() {
        usernameDisplay.textContent = `Usuário: ${currentUser.username} (${currentUser.role})`;
        logoutBtn.addEventListener('click', logout);
        
        let navHTML = `
            <button class="tab-btn active" data-view="dashboard">Dashboard</button>
            <button class="tab-btn" data-view="notasCredito">Notas de Crédito</button>
            <button class="tab-btn" data-view="empenhos">Empenhos</button>
        `;
        if (currentUser.role === 'ADMINISTRADOR') {
            navHTML += `<button class="tab-btn" data-view="admin">Administração</button>`;
        }
        appNav.innerHTML = navHTML;

        appNav.addEventListener('click', (e) => {
            if (e.target.matches('.tab-btn')) {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                navigateTo(e.target.dataset.view);
            }
        });
    }

// FIM DA PARTE 1 DE 6

// ========================================================================
    // 5. LÓGICA DAS VIEWS
    // ========================================================================

    /**
     * Renderiza a view principal do Dashboard.
     * @param {HTMLElement} container - O elemento <main> onde a view será renderizada.
     */
    async function renderDashboardView(container) {
        try {
            // Busca todos os dados do dashboard em paralelo para otimizar o carregamento
            const [kpis, avisos, graficoSecoesData] = await Promise.all([
                fetchWithAuth('/dashboard/kpis'),
                fetchWithAuth('/dashboard/avisos'),
                fetchWithAuth('/dashboard/grafico-secoes')
            ]);

            const avisosHTML = avisos.length > 0 ? avisos.map(nc => {
                const prazo = new Date(nc.prazo_empenho + 'T00:00:00');
                const hoje = new Date();
                hoje.setHours(0, 0, 0, 0);
                const diffTime = prazo - hoje;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                let avisoTexto;
                if (diffDays > 1) {
                    avisoTexto = `Vence em ${diffDays} dias (${prazo.toLocaleDateString('pt-BR')})`;
                } else if (diffDays === 1) {
                    avisoTexto = `Vence amanhã (${prazo.toLocaleDateString('pt-BR')})!`;
                } else {
                    avisoTexto = `Venceu ou vence hoje (${prazo.toLocaleDateString('pt-BR')})!`;
                }

                return `<div class="aviso-item"><strong>NC ${nc.numero_nc}:</strong> ${avisoTexto}</div>`;
            }).join('') : '<p>Nenhum aviso no momento.</p>';

            container.innerHTML = `
                <div class="view-header">
                    <h1>Dashboard</h1>
                </div>
                <div class="dashboard-grid">
                    <div class="card kpi-card">
                        <h3>Saldo Disponível Total</h3>
                        <p>${kpis.saldo_disponivel_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                    </div>
                    <div class="card kpi-card">
                        <h3>Total Empenhado</h3>
                        <p>${kpis.valor_empenhado_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                    </div>
                    <div class="card kpi-card">
                        <h3>NCs Ativas</h3>
                        <p>${kpis.ncs_ativas}</p>
                    </div>
                </div>
                <div class="card aviso-card">
                    <h3><i class="fas fa-exclamation-triangle"></i> Avisos Importantes</h3>
                    <div class="aviso-content">
                        ${avisosHTML}
                    </div>
                </div>
                <div class="card chart-card">
                    <h3>Saldo por Seção</h3>
                    <div class="chart-container">
                        <canvas id="grafico-secoes"></canvas>
                    </div>
                </div>
            `;

            renderChart('grafico-secoes', graficoSecoesData.labels, graficoSecoesData.data);

        } catch (error) {
            container.innerHTML = `<div class="error-message">Não foi possível carregar os dados do dashboard: ${error.message}</div>`;
        }
    }

    /**
     * Função auxiliar para renderizar um gráfico usando Chart.js.
     * @param {string} canvasId - O ID do elemento <canvas>.
     * @param {string[]} labels - Os rótulos do eixo X.
     * @param {number[]} data - Os valores do eixo Y.
     */
    function renderChart(canvasId, labels, data) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;

        new Chart(ctx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Saldo Disponível (R$)',
                    data: data,
                    backgroundColor: 'rgba(0, 51, 102, 0.7)',
                    borderColor: 'rgba(0, 51, 102, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { 
                    y: { 
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                            }
                        }
                    } 
                },
                plugins: { 
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    label += context.parsed.y.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                                }
                                return label;
                            }
                        }
                    }
                }
            }
        });
    }

    /**
     * ATUALIZAÇÃO da função navigateTo para incluir a nova view.
     */
    function navigateTo(view) {
        appMain.innerHTML = `<div class="loading-spinner"><p>Carregando...</p></div>`;
        switch (view) {
            case 'dashboard':
                renderDashboardView(appMain);
                break;
            // O conteúdo das outras views virá nas próximas partes
            default:
                appMain.innerHTML = `<h1>Página em construção</h1>`;
        }
    }

// FIM DA PARTE 2 DE 6

/**
     * Renderiza a view de Notas de Crédito, incluindo filtros e a tabela.
     * @param {HTMLElement} container - O elemento <main> onde a view será renderizada.
     */
    async function renderNotasCreditoView(container) {
        container.innerHTML = `
            <div class="view-header">
                <h1>Gestão de Notas de Crédito</h1>
                <button id="add-nc-btn" class="btn btn-primary"><i class="fas fa-plus"></i> Adicionar Nova NC</button>
            </div>
            <div class="filters card">
                <div class="filter-group">
                    <label for="filter-pi">Plano Interno</label>
                    <select id="filter-pi"><option value="">Todos</option></select>
                </div>
                <div class="filter-group">
                    <label for="filter-nd">Natureza de Despesa</label>
                    <select id="filter-nd"><option value="">Todas</option></select>
                </div>
                <div class="filter-group">
                    <label for="filter-secao">Seção Responsável</label>
                    <select id="filter-secao"><option value="">Todas</option></select>
                </div>
                <div class="filter-group">
                    <label for="filter-status">Status</label>
                    <select id="filter-status">
                        <option value="">Todos</option>
                        <option value="Ativa">Ativa</option>
                        <option value="Totalmente Empenhada">Totalmente Empenhada</option>
                        <option value="Expirada">Expirada</option>
                    </select>
                </div>
                <button id="apply-filters-btn" class="btn">Aplicar Filtros</button>
            </div>
            <div class="table-container card">
                <table id="nc-table">
                    <thead>
                        <tr>
                            <th>Nº da NC</th>
                            <th>Plano Interno</th>
                            <th>ND</th>
                            <th>Seção</th>
                            <th>Valor Original</th>
                            <th>Saldo Disponível</th>
                            <th>Prazo</th>
                            <th>Status</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr><td colspan="9" style="text-align:center;">Carregando dados...</td></tr>
                    </tbody>
                </table>
            </div>
        `;
        
        await populateFilters();
        await loadAndRenderNotasTable();

        document.getElementById('apply-filters-btn').addEventListener('click', () => {
            const filters = {
                plano_interno: document.getElementById('filter-pi').value,
                nd: document.getElementById('filter-nd').value,
                secao_responsavel_id: document.getElementById('filter-secao').value,
                status: document.getElementById('filter-status').value,
            };
            loadAndRenderNotasTable(filters);
        });
    }
    
    /**
     * Busca os dados e popula os filtros em cascata
     */
    async function populateFilters() {
        try {
            const [secoes, notasCredito] = await Promise.all([
                fetchWithAuth('/secoes'),
                fetchWithAuth('/notas-credito')
            ]);

            appState.secoes = secoes;

            const piSelect = document.getElementById('filter-pi');
            const ndSelect = document.getElementById('filter-nd');
            const secaoSelect = document.getElementById('filter-secao');

            secaoSelect.innerHTML = '<option value="">Todas</option>' + secoes.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');

            const planosInternos = [...new Set(notasCredito.map(nc => nc.plano_interno))];
            const naturezasDespesa = [...new Set(notasCredito.map(nc => nc.nd))];
            
            piSelect.innerHTML = '<option value="">Todos</option>' + planosInternos.sort().map(pi => `<option value="${pi}">${pi}</option>`).join('');
            ndSelect.innerHTML = '<option value="">Todas</option>' + naturezasDespesa.sort().map(nd => `<option value="${nd}">${nd}</option>`).join('');
        } catch(error) {
            console.error("Erro ao popular filtros:", error);
        }
    }

    /**
     * Carrega as Notas de Crédito da API e renderiza a tabela.
     * @param {object} filters - Um objeto com os filtros a serem aplicados.
     */
    async function loadAndRenderNotasTable(filters = {}) {
        const tableBody = document.querySelector('#nc-table tbody');
        tableBody.innerHTML = `<tr><td colspan="9" style="text-align:center;">Buscando dados...</td></tr>`;

        try {
            const params = new URLSearchParams();
            Object.entries(filters).forEach(([key, value]) => {
                if (value) params.append(key, value);
            });
            const queryString = params.toString();
            
            const notas = await fetchWithAuth(`/notas-credito?${queryString}`);
            appState.notasCredito = notas;

            if (notas.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="9" style="text-align:center;">Nenhuma Nota de Crédito encontrada para os filtros selecionados.</td></tr>`;
                return;
            }

            tableBody.innerHTML = notas.map(nc => `
                <tr>
                    <td>${nc.numero_nc}</td>
                    <td>${nc.plano_interno}</td>
                    <td>${nc.nd}</td>
                    <td>${nc.secao_responsavel.nome}</td>
                    <td>${nc.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>${nc.saldo_disponivel.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>${new Date(nc.prazo_empenho + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td><span class="status status-${nc.status.toLowerCase().replace(/ /g, '-')}">${nc.status}</span></td>
                    <td class="actions">
                        <button class="btn-icon" data-action="extrato-nc" data-id="${nc.id}" title="Ver Extrato"><i class="fas fa-file-alt"></i></button>
                        <button class="btn-icon" data-action="edit-nc" data-id="${nc.id}" title="Editar NC"><i class="fas fa-edit"></i></button>
                        ${currentUser.role === 'ADMINISTRADOR' ? 
                            `<button class="btn-icon btn-delete" data-action="delete-nc" data-id="${nc.id}" data-numero="${nc.numero_nc}" title="Excluir NC"><i class="fas fa-trash"></i></button>` : ''}
                    </td>
                </tr>
            `).join('');
        } catch (error) {
            tableBody.innerHTML = `<tr><td colspan="9" style="text-align:center; color: var(--cor-erro);">Erro ao carregar dados: ${error.message}</td></tr>`;
        }
    }

    /**
     * ATUALIZAÇÃO da função navigateTo para incluir a nova view.
     */
    function navigateTo(view) {
        appMain.innerHTML = `<div class="loading-spinner"><p>Carregando...</p></div>`;
        switch (view) {
            case 'dashboard':
                renderDashboardView(appMain);
                break;
            case 'notasCredito':
                renderNotasCreditoView(appMain);
                break;
            // Outras views serão adicionadas nas próximas partes
            default:
                appMain.innerHTML = `<h1>Página em construção</h1>`;
        }
    }
    
// FIM DA PARTE 3 DE 6

// ========================================================================
    // 6. LÓGICA DE MODAIS E FORMULÁRIOS
    // ========================================================================

    /**
     * Abre um modal genérico na tela.
     * @param {string} title - O título do modal.
     * @param {string} contentHTML - O HTML para o corpo do modal.
     * @param {function} onOpen - (Opcional) Callback a ser executado após o modal ser aberto.
     */
    function openModal(title, contentHTML, onOpen) {
        const modalClone = modalTemplate.content.cloneNode(true);
        const modalElement = modalClone.querySelector('.modal');
        
        modalClone.querySelector('.modal-title').textContent = title;
        modalClone.querySelector('.modal-body').innerHTML = contentHTML;
        
        modalContainer.innerHTML = ''; // Limpa modais anteriores
        modalContainer.appendChild(modalClone);
        
        const newModal = modalContainer.querySelector('.modal-backdrop');
        newModal.addEventListener('click', (e) => { if (e.target === newModal) closeModal(); });
        newModal.querySelector('.modal-close-btn').addEventListener('click', closeModal);

        if (onOpen) onOpen(modalElement);
    }

    /**
     * Fecha o modal atualmente aberto.
     */
    function closeModal() {
        modalContainer.innerHTML = '';
    }

    /**
     * Gera o HTML para o formulário de Nota de Crédito.
     * @param {object} nc - (Opcional) Objeto NC para preencher o formulário para edição.
     * @returns {string} HTML do formulário.
     */
    function getNotaCreditoFormHTML(nc = {}) {
        const isEditing = !!nc.id;
        const secoesOptions = appState.secoes.map(s => 
            `<option value="${s.id}" ${s.id === nc.secao_responsavel_id ? 'selected' : ''}>${s.nome}</option>`
        ).join('');

        return `
            <form id="nc-form" data-id="${isEditing ? nc.id : ''}">
                <div class="form-grid">
                    <div class="form-field"><label for="numero_nc">Número da NC</label><input type="text" name="numero_nc" value="${nc.numero_nc || ''}" required></div>
                    <div class="form-field"><label for="valor">Valor (R$)</label><input type="number" name="valor" step="0.01" value="${nc.valor || ''}" required></div>
                    <div class="form-field"><label for="secao_responsavel_id">Seção Responsável</label><select name="secao_responsavel_id" required>${secoesOptions}</select></div>
                    <div class="form-field"><label for="plano_interno">Plano Interno</label><input type="text" name="plano_interno" value="${nc.plano_interno || ''}" required></div>
                    <div class="form-field"><label for="nd">Natureza de Despesa</label><input type="text" name="nd" value="${nc.nd || ''}" required pattern="\\d{6}" title="Deve conter 6 dígitos numéricos."></div>
                    <div class="form-field"><label for="ptres">PTRES</label><input type="text" name="ptres" value="${nc.ptres || ''}" required maxlength="6"></div>
                    <div class="form-field"><label for="fonte">Fonte</label><input type="text" name="fonte" value="${nc.fonte || ''}" required maxlength="10"></div>
                    <div class="form-field"><label for="esfera">Esfera</label><input type="text" name="esfera" value="${nc.esfera || ''}" required></div>
                    <div class="form-field"><label for="data_chegada">Data de Chegada</label><input type="date" name="data_chegada" value="${nc.data_chegada || ''}" required></div>
                    <div class="form-field"><label for="prazo_empenho">Prazo para Empenho</label><input type="date" name="prazo_empenho" value="${nc.prazo_empenho || ''}" required></div>
                    <div class="form-field form-field-full"><label for="descricao">Descrição</label><textarea name="descricao">${nc.descricao || ''}</textarea></div>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">${isEditing ? 'Salvar Alterações' : 'Criar Nota de Crédito'}</button>
                </div>
            </form>
        `;
    }
    
    /**
     * Manipula a submissão de um formulário de NC (criação ou edição).
     */
    async function handleNcFormSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const id = form.dataset.id;
        const method = id ? 'PUT' : 'POST';
        const endpoint = id ? `/notas-credito/${id}` : '/notas-credito';

        const submitButton = form.querySelector('button[type="submit"]');
        submitButton.disabled = true;

        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());
        data.valor = parseFloat(data.valor);
        data.secao_responsavel_id = parseInt(data.secao_responsavel_id);

        try {
            await fetchWithAuth(endpoint, { method, body: JSON.stringify(data) });
            closeModal();
            const currentFilters = getCurrentFilters();
            await loadAndRenderNotasTable(currentFilters); 
        } catch (error) {
            alert(`Erro ao salvar: ${error.message}`);
            submitButton.disabled = false;
        }
    }

    function getCurrentFilters() {
        return {
            plano_interno: document.getElementById('filter-pi')?.value,
            nd: document.getElementById('filter-nd')?.value,
            secao_responsavel_id: document.getElementById('filter-secao')?.value,
            status: document.getElementById('filter-status')?.value,
        };
    }
    
    // ========================================================================
    // 7. MANIPULADORES DE EVENTOS GLOBAIS (Event Handlers)
    // ========================================================================

    // Delegação de eventos no container <main> para ações dinâmicas
    appMain.addEventListener('click', async (e) => {
        const target = e.target.closest('button');
        if (!target) return;

        const action = target.dataset.action;
        const id = target.dataset.id;

        // --- Ação: Adicionar Nova NC ---
        if (target.id === 'add-nc-btn') {
            const formHTML = getNotaCreditoFormHTML();
            openModal('Adicionar Nova Nota de Crédito', formHTML, (modalElement) => {
                modalElement.querySelector('#nc-form').addEventListener('submit', handleNcFormSubmit);
            });
        }
        
        // --- Ação: Editar NC ---
        if (action === 'edit-nc') {
            try {
                const ncData = await fetchWithAuth(`/notas-credito/${id}`);
                const formHTML = getNotaCreditoFormHTML(ncData);
                openModal(`Editar Nota de Crédito: ${ncData.numero_nc}`, formHTML, (modalElement) => {
                    modalElement.querySelector('#nc-form').addEventListener('submit', handleNcFormSubmit);
                });
            } catch (error) {
                alert(`Erro ao buscar dados da NC: ${error.message}`);
            }
        }

        // --- Ação: Excluir NC ---
        if (action === 'delete-nc') {
            const numeroNc = target.dataset.numero;
            if (confirm(`Tem certeza que deseja excluir a Nota de Crédito "${numeroNc}"?\n\nEsta ação não pode ser desfeita.`)) {
                try {
                    await fetchWithAuth(`/notas-credito/${id}`, { method: 'DELETE' });
                    const currentFilters = getCurrentFilters();
                    await loadAndRenderNotasTable(currentFilters);
                } catch (error) {
                    alert(`Erro ao excluir NC: ${error.message}`);
                }
            }
        }
    });

// FIM DA PARTE 4 DE 6

// ========================================================================
    // 8. LÓGICA DAS VIEWS DE ADMINISTRAÇÃO
    // ========================================================================

    /**
     * Renderiza a view principal de Administração com suas sub-abas.
     * @param {HTMLElement} container - O elemento <main> onde a view será renderizada.
     * @param {string} subView - A sub-aba a ser mostrada por padrão ('secoes' ou 'users').
     */
    function renderAdminView(container, subView = 'secoes') {
        if (currentUser.role !== 'ADMINISTRADOR') {
            container.innerHTML = `<div class="error-message">Acesso negado. Esta área é restrita a administradores.</div>`;
            return;
        }

        container.innerHTML = `
            <div class="view-header">
                <h1>Administração do Sistema</h1>
            </div>
            <nav class="sub-nav">
                <button class="sub-tab-btn" data-subview="secoes">Gerenciar Seções</button>
                <button class="sub-tab-btn" data-subview="users">Gerenciar Usuários</button>
                <button class="sub-tab-btn" data-subview="logs">Logs de Auditoria</button>
            </nav>
            <div id="admin-content" class="card">
                </div>
        `;

        const adminContent = document.getElementById('admin-content');

        container.querySelector('.sub-nav').addEventListener('click', (e) => {
            if (e.target.matches('.sub-tab-btn')) {
                const newSubView = e.target.dataset.subview;
                container.querySelectorAll('.sub-tab-btn').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
                renderAdminSubView(adminContent, newSubView);
            }
        });
        
        container.querySelector(`.sub-tab-btn[data-subview="${subView}"]`).classList.add('active');
        renderAdminSubView(adminContent, subView);
    }
    
    /**
     * Roteador para o conteúdo da área de administração.
     */
    function renderAdminSubView(container, subView) {
        container.innerHTML = `<div class="loading-spinner"><p>Carregando...</p></div>`;
        if (subView === 'users') {
            renderAdminUsersView(container);
        } else if (subView === 'secoes') {
            renderAdminSeçõesView(container);
        } else if (subView === 'logs'){
            // A view de Logs virá na próxima e última parte
            container.innerHTML = `<h3>Logs de Auditoria (Conteúdo virá na Parte 6)</h3>`;
        }
    }

    /**
     * Renderiza a interface para gerenciamento de seções.
     */
    async function renderAdminSeçõesView(container) {
        container.innerHTML = `
            <h3>Gerenciar Seções</h3>
            <p>Adicione, renomeie ou exclua seções da lista utilizada nos formulários.</p>
            <form id="secao-form" class="admin-form">
                <input type="hidden" name="id" value="">
                <input type="text" name="nome" placeholder="Nome da seção" required>
                <button type="submit" class="btn btn-primary">Adicionar Seção</button>
            </form>
            <div class="table-container" style="margin-top: 1.5rem;">
                <table id="secoes-table">
                    <thead><tr><th>ID</th><th>Nome da Seção</th><th>Ações</th></tr></thead>
                    <tbody></tbody>
                </table>
            </div>
        `;
        
        await loadAndRenderSeçõesTable();
        container.querySelector('#secao-form').addEventListener('submit', handleSecaoFormSubmit);
    }

    /**
     * Carrega e renderiza a tabela de seções.
     */
    async function loadAndRenderSeçõesTable() {
        const tableBody = document.querySelector('#secoes-table tbody');
        try {
            const secoes = await fetchWithAuth('/secoes');
            appState.secoes = secoes;
            tableBody.innerHTML = secoes.length === 0 ? '<tr><td colspan="3">Nenhuma seção cadastrada.</td></tr>' :
                secoes.map(s => `
                    <tr>
                        <td>${s.id}</td>
                        <td>${s.nome}</td>
                        <td class="actions">
                            <button class="btn-icon" data-action="edit-secao" data-id="${s.id}" data-nome="${s.nome}" title="Editar"><i class="fas fa-edit"></i></button>
                            <button class="btn-icon btn-delete" data-action="delete-secao" data-id="${s.id}" data-nome="${s.nome}" title="Excluir"><i class="fas fa-trash"></i></button>
                        </td>
                    </tr>
                `).join('');
        } catch (error) {
            tableBody.innerHTML = `<tr><td colspan="3" class="error-message">Erro ao carregar seções: ${error.message}</td></tr>`;
        }
    }

    /**
     * Manipula a submissão do formulário de seção (Adicionar/Editar).
     */
    async function handleSecaoFormSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const id = form.id.value;
        const nome = form.nome.value;
        const method = id ? 'PUT' : 'POST';
        const endpoint = id ? `/secoes/${id}` : '/secoes';

        try {
            await fetchWithAuth(endpoint, { method, body: JSON.stringify({ nome }) });
            form.reset();
            form.querySelector('input[name="id"]').value = '';
            form.querySelector('button[type="submit"]').textContent = 'Adicionar Seção';
            await loadAndRenderSeçõesTable();
        } catch (error) {
            alert(`Erro ao salvar seção: ${error.message}`);
        }
    }

    /**
     * Renderiza a interface para gerenciamento de usuários.
     */
    async function renderAdminUsersView(container) {
        container.innerHTML = `
            <h3>Gerenciar Usuários</h3>
            <p>Adicione novos usuários e defina seus perfis de acesso.</p>
            <form id="user-form" class="admin-form-grid">
                <input type="text" name="username" placeholder="Nome de usuário" required>
                <input type="email" name="email" placeholder="E-mail" required>
                <input type="password" name="password" placeholder="Senha" required>
                <select name="role" required>
                    <option value="OPERADOR">Operador</option>
                    <option value="ADMINISTRADOR">Administrador</option>
                </select>
                <button type="submit" class="btn btn-primary">Adicionar Usuário</button>
            </form>
            <div class="table-container" style="margin-top: 1.5rem;">
                <table id="users-table">
                    <thead><tr><th>ID</th><th>Usuário</th><th>E-mail</th><th>Perfil</th><th>Ações</th></tr></thead>
                    <tbody></tbody>
                </table>
            </div>
        `;
        
        await loadAndRenderUsersTable();
        container.querySelector('#user-form').addEventListener('submit', handleUserFormSubmit);
    }

    /**
     * Carrega e renderiza a tabela de usuários.
     */
    async function loadAndRenderUsersTable() {
        const tableBody = document.querySelector('#users-table tbody');
        try {
            const users = await fetchWithAuth('/users');
            appState.users = users;
            tableBody.innerHTML = users.length === 0 ? '<tr><td colspan="5">Nenhum usuário cadastrado.</td></tr>' :
                users.map(u => `
                    <tr>
                        <td>${u.id}</td>
                        <td>${u.username}</td>
                        <td>${u.email}</td>
                        <td>${u.role}</td>
                        <td class="actions">
                            ${u.id === currentUser.id ? '<span>(Você)</span>' : 
                            `<button class="btn-icon btn-delete" data-action="delete-user" data-id="${u.id}" data-username="${u.username}" title="Excluir"><i class="fas fa-trash"></i></button>`}
                        </td>
                    </tr>
                `).join('');
        } catch (error) {
            tableBody.innerHTML = `<tr><td colspan="5" class="error-message">Erro ao carregar usuários: ${error.message}</td></tr>`;
        }
    }
    
    /**
     * Manipula a submissão do formulário de usuário (Adicionar).
     */
    async function handleUserFormSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const data = Object.fromEntries(new FormData(form).entries());

        try {
            await fetchWithAuth('/users', { method: 'POST', body: JSON.stringify(data) });
            form.reset();
            await loadAndRenderUsersTable();
        } catch (error) {
            alert(`Erro ao criar usuário: ${error.message}`);
        }
    }

    /**
     * ATUALIZAÇÃO da função navigateTo para incluir a view de Admin.
     */
    function navigateTo(view) {
        appMain.innerHTML = `<div class="loading-spinner"><p>Carregando...</p></div>`;
        switch (view) {
            case 'dashboard':
                renderDashboardView(appMain);
                break;
            case 'notasCredito':
                renderNotasCreditoView(appMain);
                break;
            case 'empenhos':
                // renderEmpenhosView(appMain); // Esta função virá em uma parte futura
                appMain.innerHTML = `<h1>Página de Empenhos em construção</h1>`;
                break;
            case 'admin':
                renderAdminView(appMain);
                break;
            default:
                appMain.innerHTML = `<h1>Página não encontrada.</h1>`;
        }
    }

// FIM DA PARTE 5 DE 6

/**
     * Renderiza a interface para visualização dos logs de auditoria.
     */
    async function renderAdminLogsView(container) {
        container.innerHTML = `
            <h3>Log de Auditoria</h3>
            <p>Registro de todas as ações importantes realizadas no sistema.</p>
            <div class="table-container" style="margin-top: 1.5rem;">
                <table id="logs-table">
                    <thead><tr><th>Data/Hora (UTC)</th><th>Usuário</th><th>Ação</th><th>Detalhes</th></tr></thead>
                    <tbody></tbody>
                </table>
            </div>
            <div class="pagination">
                </div>
        `;
        await loadAndRenderAuditLogsTable();
    }

    /**
     * Carrega e renderiza a tabela de logs de auditoria.
     */
    async function loadAndRenderAuditLogsTable() {
        const tableBody = document.querySelector('#logs-table tbody');
        tableBody.innerHTML = '<tr><td colspan="4">Carregando logs...</td></tr>';

        try {
            // Por padrão, busca os 100 logs mais recentes.
            const logs = await fetchWithAuth(`/audit-logs?limit=100`);
            
            if (logs.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="4">Nenhum log de auditoria encontrado.</td></tr>';
                return;
            }

            tableBody.innerHTML = logs.map(log => `
                <tr>
                    <td>${new Date(log.timestamp).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })}</td>
                    <td>${log.username}</td>
                    <td><span class="log-action">${log.action}</span></td>
                    <td>${log.details || ''}</td>
                </tr>
            `).join('');

        } catch (error) {
            tableBody.innerHTML = `<tr><td colspan="4" class="error-message">Erro ao carregar logs: ${error.message}</td></tr>`;
        }
    }
    
    /**
     * ATUALIZAÇÃO FINAL da função de navegação para incluir todas as views.
     */
    function navigateTo(view) {
        appMain.innerHTML = `<div class="loading-spinner"><p>Carregando...</p></div>`;
        
        const mainAdminView = view.startsWith('admin') ? 'admin' : view;

        switch (mainAdminView) {
            case 'dashboard':
                renderDashboardView(appMain);
                break;
            case 'notasCredito':
                renderNotasCreditoView(appMain);
                break;
            case 'empenhos':
                renderEmpenhosView(appMain);
                break;
            case 'admin':
                const subView = view.split('-')[1] || 'secoes'; // Padrão para 'secoes'
                renderAdminView(appMain, subView);
                break;
            default:
                appMain.innerHTML = `<h1>Página não encontrada.</h1>`;
        }
    }
    
    // ========================================================================
    // 9. INICIALIZAÇÃO DA APLICAÇÃO
    // ========================================================================
    
    // Inicia todo o processo de verificação e renderização.
    initApp();
});

// FIM DA PARTE 6 DE 6
// O ARQUIVO main.js ESTÁ COMPLETO
