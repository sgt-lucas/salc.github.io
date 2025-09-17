document.addEventListener('DOMContentLoaded', () => {
    // ========================================================================
    // 1. CONFIGURAÇÃO INICIAL E ESTADO DA APLICAÇÃO
    // ========================================================================

    // IMPORTANTE: Verifique se esta URL corresponde exatamente à URL do seu backend no Render.
    const API_URL = 'https://salc.onrender.com';

    let currentUser = null; // Armazenará { username, role, ... }
    
    // Cache de dados para evitar requisições repetidas e manter o estado da UI
    let appState = {
        secoes: [],
        notasCredito: { total: 0, page: 1, size: 10, results: [] },
        empenhos: { total: 0, page: 1, size: 10, results: [] },
        users: [],
        auditLogs: [],
        currentFilters: {}, // Guarda os filtros aplicados para preservar o estado
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
        try {
            currentUser = await fetchWithAuth('/users/me');
            renderLayout();
            navigateTo('dashboard');
        } catch (error) {
            window.location.href = 'login.html';
        }
    }

    async function logout() {
        try {
            await fetchWithAuth('/logout', { method: 'POST' });
        } catch (error) {
            console.error("Erro no pedido de logout, mas a redirecionar mesmo assim:", error);
        } finally {
            window.location.href = 'login.html';
        }
    }

    // ========================================================================
    // 3. FUNÇÃO AUXILIAR PARA REQUISIÇÕES À API
    // ========================================================================

    async function fetchWithAuth(endpoint, options = {}) {
        const defaultOptions = {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
        };
        const mergedOptions = { ...defaultOptions, ...options, headers: { ...defaultOptions.headers, ...options.headers } };
        try {
            const response = await fetch(`${API_URL}${endpoint}`, mergedOptions);
            if (response.status === 401) {
                window.location.href = 'login.html';
                throw new Error('Sessão expirada. Por favor, faça login novamente.');
            }
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ detail: response.statusText }));
                throw new Error(errorData.detail || 'Ocorreu um erro na requisição.');
            }
            if (options.responseType === 'blob') return response.blob();
            return response.status === 204 ? null : response.json();
        } catch (error) {
            throw error;
        }
    }

    // ========================================================================
    // 4. LÓGICA DE MODAIS E NOTIFICAÇÕES
    // ========================================================================

    function openModal(title, contentHTML, onOpen) {
        const modalClone = modalTemplate.content.cloneNode(true);
        const modalBackdrop = modalClone.querySelector('.modal-backdrop');
        const modalElement = modalClone.querySelector('.modal');
        modalClone.querySelector('.modal-title').textContent = title;
        modalClone.querySelector('.modal-body').innerHTML = contentHTML;
        modalContainer.innerHTML = '';
        modalContainer.appendChild(modalClone);
        const closeModalFunc = () => { modalContainer.innerHTML = ''; };
        modalBackdrop.addEventListener('click', (e) => { if (e.target === modalBackdrop) closeModalFunc(); });
        modalElement.querySelector('.modal-close-btn').addEventListener('click', closeModalFunc);
        if (onOpen) onOpen(modalElement, closeModalFunc);
    }

    function showConfirmationModal(title, message, onConfirm) {
        const contentHTML = `
            <p>${message}</p>
            <div class="form-actions" style="justify-content: flex-end; display: flex; gap: 1rem;">
                <button id="confirm-cancel-btn" class="btn">Cancelar</button>
                <button id="confirm-action-btn" class="btn btn-primary">Confirmar</button>
            </div>`;
        openModal(title, contentHTML, (modalElement, closeModalFunc) => {
            modalElement.querySelector('#confirm-action-btn').addEventListener('click', () => { onConfirm(); closeModalFunc(); });
            modalElement.querySelector('#confirm-cancel-btn').addEventListener('click', closeModalFunc);
        });
    }

    // ========================================================================
    // 5. RENDERIZAÇÃO DO LAYOUT E NAVEGAÇÃO
    // ========================================================================

    function renderLayout() {
        usernameDisplay.textContent = `Utilizador: ${currentUser.username} (${currentUser.role})`;
        logoutBtn.addEventListener('click', logout);
        let navHTML = `
            <button class="tab-btn active" data-view="dashboard">Dashboard</button>
            <button class="tab-btn" data-view="notasCredito">Notas de Crédito</button>
            <button class="tab-btn" data-view="empenhos">Empenhos</button>`;
        if (currentUser.role === 'ADMINISTRADOR') {
            navHTML += `<button class="tab-btn" data-view="admin">Administração</button>`;
        }
        appNav.innerHTML = navHTML;
        appNav.addEventListener('click', (e) => {
            if (e.target.matches('.tab-btn')) {
                appNav.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                navigateTo(e.target.dataset.view);
            }
        });
    }

    async function navigateTo(view, params = {}) {
        appMain.innerHTML = `<div class="loading-spinner"><p>A carregar...</p></div>`;
        try {
            switch (view) {
                case 'dashboard': await renderDashboardView(appMain); break;
                case 'notasCredito': await renderNotasCreditoView(appMain, params.page || 1); break;
                case 'empenhos': await renderEmpenhosView(appMain, params.page || 1); break;
                case 'admin': await renderAdminView(appMain); break;
                default: appMain.innerHTML = `<h1>Página não encontrada</h1>`;
            }
        } catch (error) {
            appMain.innerHTML = `<div class="card error-message"><h3>Erro ao carregar a página</h3><p>${error.message}</p></div>`;
        }
    }

    function renderPagination(container, totalItems, currentPage, pageSize, onPageChange) {
        if (totalItems <= pageSize) {
            container.innerHTML = ''; return;
        }
        const totalPages = Math.ceil(totalItems / pageSize);
        const startItem = (currentPage - 1) * pageSize + 1;
        const endItem = Math.min(currentPage * pageSize, totalItems);
        container.innerHTML = `
            <div class="pagination">
                <button id="prev-page-btn" class="btn" ${currentPage === 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i> Anterior</button>
                <span class="pagination-info">A exibir ${startItem}–${endItem} de ${totalItems}</span>
                <button id="next-page-btn" class="btn" ${currentPage === totalPages ? 'disabled' : ''}>Próxima <i class="fas fa-chevron-right"></i></button>
            </div>`;
        const prevBtn = container.querySelector('#prev-page-btn');
        const nextBtn = container.querySelector('#next-page-btn');
        if (prevBtn) prevBtn.addEventListener('click', () => onPageChange(currentPage - 1));
        if (nextBtn) nextBtn.addEventListener('click', () => onPageChange(currentPage + 1));
    }

    // ========================================================================
    // 6. LÓGICA DAS VIEWS
    // ========================================================================

    async function renderDashboardView(container) {
        if (appState.secoes.length === 0) {
            try { appState.secoes = await fetchWithAuth('/secoes'); } catch (error) { console.error("Erro ao carregar seções:", error); }
        }
        container.innerHTML = `
            <div class="view-header"><h1>Dashboard</h1></div>
            <div class="dashboard-grid">
                <div class="card kpi-card"><h3>Saldo Disponível Total</h3><p id="kpi-saldo-total">A carregar...</p></div>
                <div class="card kpi-card"><h3>Total Empenhado</h3><p id="kpi-valor-empenhado">A carregar...</p></div>
                <div class="card kpi-card"><h3>NCs Ativas</h3><p id="kpi-ncs-ativas">A carregar...</p></div>
            </div>
            <div class="card aviso-card"><h3><i class="fas fa-exclamation-triangle"></i> Avisos Importantes (Próximos 7 dias)</h3><div id="aviso-content">A carregar...</div></div>
            <div class="card">
                <div class="view-header"><h3>Gerar Relatório em PDF</h3><button id="generate-report-btn" class="btn btn-primary"><i class="fas fa-file-pdf"></i> Gerar Relatório</button></div>
                <div class="filters">
                    <div class="filter-group"><label for="report-filter-pi">Plano Interno</label><input type="text" id="report-filter-pi" placeholder="Opcional"></div>
                    <div class="filter-group"><label for="report-filter-nd">Natureza de Despesa</label><input type="text" id="report-filter-nd" placeholder="Opcional"></div>
                    <div class="filter-group"><label for="report-filter-secao">Seção Responsável</label><select id="report-filter-secao"><option value="">Todas</option></select></div>
                    <div class="filter-group"><label for="report-filter-status">Status</label><select id="report-filter-status"><option value="">Todos</option><option value="Ativa">Ativa</option><option value="Totalmente Empenhada">Totalmente Empenhada</option></select></div>
                </div>
            </div>`;
        const secaoSelect = container.querySelector('#report-filter-secao');
        if (secaoSelect) secaoSelect.innerHTML = '<option value="">Todas</option>' + appState.secoes.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
        container.querySelector('#generate-report-btn').addEventListener('click', generateReport);
        loadDashboardData();
    }

    async function loadDashboardData() {
        try {
            const [kpis, avisos] = await Promise.all([fetchWithAuth('/dashboard/kpis'), fetchWithAuth('/dashboard/avisos')]);
            document.getElementById('kpi-saldo-total').textContent = kpis.saldo_disponivel_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            document.getElementById('kpi-valor-empenhado').textContent = kpis.valor_empenhado_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            document.getElementById('kpi-ncs-ativas').textContent = kpis.ncs_ativas;
            const avisoContainer = document.getElementById('aviso-content');
            if (avisos.length > 0) {
                avisoContainer.innerHTML = avisos.map(nc => {
                    const prazo = new Date(nc.prazo_empenho + 'T00:00:00');
                    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
                    const diffDays = Math.ceil((prazo - hoje) / (1000 * 60 * 60 * 24));
                    let avisoTexto = diffDays > 1 ? `Vence em ${diffDays} dias` : diffDays === 1 ? `Vence amanhã` : diffDays === 0 ? `Vence hoje` : `Venceu há ${Math.abs(diffDays)} dia(s)`;
                    return `<div class="aviso-item"><strong>NC ${nc.numero_nc}:</strong> ${avisoTexto} (${prazo.toLocaleDateString('pt-BR')})</div>`;
                }).join('');
            } else {
                avisoContainer.innerHTML = '<p>Nenhum aviso no momento.</p>';
            }
        } catch (error) {
            console.error("Erro ao carregar dados do dashboard:", error);
            ['kpi-saldo-total', 'kpi-valor-empenhado', 'kpi-ncs-ativas'].forEach(id => document.getElementById(id).textContent = 'Erro');
            document.getElementById('aviso-content').innerHTML = `<p class="error-message">Não foi possível carregar os avisos.</p>`;
        }
    }

    async function generateReport() {
        const btn = document.getElementById('generate-report-btn');
        btn.disabled = true; btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> A gerar...`;
        const filters = {
            plano_interno: document.getElementById('report-filter-pi').value || undefined,
            nd: document.getElementById('report-filter-nd').value || undefined,
            secao_responsavel_id: document.getElementById('report-filter-secao').value || undefined,
            status: document.getElementById('report-filter-status').value || undefined,
        };
        Object.keys(filters).forEach(key => filters[key] === undefined && delete filters[key]);
        const params = new URLSearchParams(filters).toString();
        try {
            const blob = await fetchWithAuth(`/relatorios/pdf?${params}`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none'; a.href = url; a.download = 'relatorio_salc.pdf';
            document.body.appendChild(a); a.click();
            window.URL.revokeObjectURL(url); a.remove();
        } catch (error) {
            openModal('Erro ao Gerar Relatório', `<p>${error.message}</p>`);
        } finally {
            btn.disabled = false; btn.innerHTML = `<i class="fas fa-file-pdf"></i> Gerar Relatório`;
        }
    }

    async function renderNotasCreditoView(container, page) {
        container.innerHTML = `
            <div class="view-header"><h1>Gestão de Notas de Crédito</h1><button id="add-nc-btn" class="btn btn-primary"><i class="fas fa-plus"></i> Adicionar Nova NC</button></div>
            <div class="filters card">
                <div class="filter-group"><label for="filter-pi">Plano Interno</label><input type="text" id="filter-pi" placeholder="Filtrar por PI"></div>
                <div class="filter-group"><label for="filter-nd">Natureza de Despesa</label><input type="text" id="filter-nd" placeholder="Filtrar por ND"></div>
                <div class="filter-group"><label for="filter-secao">Seção Responsável</label><select id="filter-secao"><option value="">Todas</option></select></div>
                <div class="filter-group"><label for="filter-status">Status</label><select id="filter-status"><option value="">Todos</option><option value="Ativa">Ativa</option><option value="Totalmente Empenhada">Totalmente Empenhada</option></select></div>
                <button id="apply-filters-btn" class="btn">Aplicar Filtros</button>
            </div>
            <div class="table-container card">
                <table id="nc-table">
                    <thead><tr><th>Nº da NC</th><th>Plano Interno</th><th>ND</th><th>Seção</th><th>Valor Original</th><th>Saldo Disponível</th><th>Prazo</th><th>Status</th><th class="actions">Ações</th></tr></thead>
                    <tbody></tbody>
                </table>
            </div>
            <div id="nc-pagination-container"></div>`;
        const secaoSelect = container.querySelector('#filter-secao');
        if (appState.secoes.length > 0) secaoSelect.innerHTML = '<option value="">Todas</option>' + appState.secoes.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
        container.querySelector('#filter-pi').value = appState.currentFilters.plano_interno || '';
        container.querySelector('#filter-nd').value = appState.currentFilters.nd || '';
        container.querySelector('#filter-secao').value = appState.currentFilters.secao_responsavel_id || '';
        container.querySelector('#filter-status').value = appState.currentFilters.status || '';
        await loadNotasCreditoTable(page);
        container.querySelector('#apply-filters-btn').addEventListener('click', () => {
            appState.currentFilters = {
                plano_interno: container.querySelector('#filter-pi').value,
                nd: container.querySelector('#filter-nd').value,
                secao_responsavel_id: container.querySelector('#filter-secao').value,
                status: container.querySelector('#filter-status').value,
            };
            loadNotasCreditoTable(1);
        });
        container.querySelector('#add-nc-btn').addEventListener('click', () => {
            const formHTML = getNotaCreditoFormHTML();
            openModal('Adicionar Nova Nota de Crédito', formHTML, (modalElement, closeModalFunc) => {
                modalElement.querySelector('#nc-form').addEventListener('submit', (e) => handleNcFormSubmit(e, closeModalFunc));
            });
        });
    }

    async function loadNotasCreditoTable(page = 1) {
        const tableBody = document.querySelector('#nc-table tbody');
        if (!tableBody) return;
        tableBody.innerHTML = `<tr><td colspan="9" style="text-align:center;">A buscar dados...</td></tr>`;
        try {
            const cleanFilters = Object.fromEntries(Object.entries(appState.currentFilters).filter(([_, v]) => v != ''));
            const params = new URLSearchParams({ page, size: appState.notasCredito.size, ...cleanFilters });
            const data = await fetchWithAuth(`/notas-credito?${params.toString()}`);
            appState.notasCredito = data;
            if (data.results.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="9" style="text-align:center;">Nenhuma Nota de Crédito encontrada.</td></tr>`;
                document.getElementById('nc-pagination-container').innerHTML = ''; return;
            }
            tableBody.innerHTML = data.results.map(nc => `
                <tr data-id="${nc.id}">
                    <td>${nc.numero_nc}</td><td>${nc.plano_interno}</td><td>${nc.nd}</td><td>${nc.secao_responsavel.nome}</td>
                    <td>${nc.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>${nc.saldo_disponivel.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>${new Date(nc.prazo_empenho + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td><span class="status status-${nc.status.toLowerCase().replace(/ /g, '-')}">${nc.status}</span></td>
                    <td class="actions">
                        <button class="btn-icon" data-action="edit-nc" data-id="${nc.id}" title="Editar NC"><i class="fas fa-edit"></i></button>
                        ${currentUser.role === 'ADMINISTRADOR' ? `<button class="btn-icon btn-delete" data-action="delete-nc" data-id="${nc.id}" data-numero="${nc.numero_nc}" title="Excluir NC"><i class="fas fa-trash"></i></button>` : ''}
                    </td>
                </tr>`).join('');
            const paginationContainer = document.getElementById('nc-pagination-container');
            renderPagination(paginationContainer, data.total, data.page, data.size, (newPage) => loadNotasCreditoTable(newPage));
        } catch (error) {
            tableBody.innerHTML = `<tr><td colspan="9" class="error-message">Erro ao carregar dados: ${error.message}</td></tr>`;
        }
    }
    
    function getNotaCreditoFormHTML(nc = {}) {
        const isEditing = !!nc.id;
        const secoesOptions = appState.secoes.map(s => `<option value="${s.id}" ${s.id === nc.secao_responsavel_id ? 'selected' : ''}>${s.nome}</option>`).join('');
        return `
            <form id="nc-form" data-id="${isEditing ? nc.id : ''}" novalidate>
                <div class="form-grid">
                    <div class="form-field"><label for="numero_nc">Número da NC</label><input type="text" name="numero_nc" value="${nc.numero_nc || ''}" required></div>
                    <div class="form-field"><label for="valor">Valor (R$)</label><input type="number" name="valor" step="0.01" value="${nc.valor || ''}" required min="0.01"></div>
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
                <div id="form-feedback" class="modal-feedback" style="display: none;"></div>
                <div class="form-actions"><button type="submit" class="btn btn-primary">${isEditing ? 'Salvar Alterações' : 'Criar Nota de Crédito'}</button></div>
            </form>`;
    }
    
    async function handleNcFormSubmit(e, closeModalFunc) {
        e.preventDefault();
        const form = e.target;
        const submitButton = form.querySelector('button[type="submit"]');
        const feedbackContainer = form.querySelector('#form-feedback');
        if (!form.checkValidity()) {
            feedbackContainer.textContent = 'Por favor, preencha todos os campos obrigatórios corretamente.';
            feedbackContainer.style.display = 'block'; return;
        }
        const dataChegada = form.elements.data_chegada.value, prazoEmpenho = form.elements.prazo_empenho.value;
        if (prazoEmpenho < dataChegada) {
            feedbackContainer.textContent = 'O prazo para empenho não pode ser anterior à data de chegada.';
            feedbackContainer.style.display = 'block'; return;
        }
        submitButton.disabled = true; submitButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i> A salvar...`;
        feedbackContainer.style.display = 'none';
        const id = form.dataset.id;
        const method = id ? 'PUT' : 'POST', endpoint = id ? `/notas-credito/${id}` : '/notas-credito';
        const formData = new FormData(form), data = Object.fromEntries(formData.entries());
        data.valor = parseFloat(data.valor); data.secao_responsavel_id = parseInt(data.secao_responsavel_id);
        try {
            await fetchWithAuth(endpoint, { method, body: JSON.stringify(data) });
            closeModalFunc();
            await loadNotasCreditoTable(appState.notasCredito.page);
        } catch (error) {
            feedbackContainer.textContent = `Erro ao salvar: ${error.message}`;
            feedbackContainer.style.display = 'block';
        } finally {
            submitButton.disabled = false;
            submitButton.innerHTML = id ? 'Salvar Alterações' : 'Criar Nota de Crédito';
        }
    }

    async function renderEmpenhosView(container, page) {
        container.innerHTML = `
            <div class="view-header"><h1>Gestão de Empenhos</h1><button id="add-empenho-btn" class="btn btn-primary"><i class="fas fa-plus"></i> Novo Empenho</button></div>
            <div class="table-container card">
                <table id="empenhos-table">
                    <thead><tr><th>Nº do Empenho</th><th>Nº da NC Associada</th><th>Seção Requisitante</th><th>Valor</th><th>Data</th><th class="actions">Ações</th></tr></thead>
                    <tbody></tbody>
                </table>
            </div>
            <div id="empenhos-pagination-container"></div>`;
        await loadEmpenhosTable(page);
        container.querySelector('#add-empenho-btn').addEventListener('click', async () => {
            try {
                const [notasData, secoes] = await Promise.all([
                    fetchWithAuth('/notas-credito?size=1000&status=Ativa'), 
                    fetchWithAuth('/secoes')
                ]);
                const formHTML = getEmpenhoFormHTML({}, notasData.results, secoes);
                openModal('Novo Empenho', formHTML, (modalElement, closeModalFunc) => {
                    modalElement.querySelector('#empenho-form').addEventListener('submit', (e) => handleEmpenhoFormSubmit(e, closeModalFunc));
                });
            } catch (error) {
                openModal('Erro', `<p>Não foi possível carregar os dados para o formulário: ${error.message}</p>`);
            }
        });
    }

    async function loadEmpenhosTable(page = 1) {
        const tableBody = document.querySelector('#empenhos-table tbody');
        if (!tableBody) return;
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;">A buscar dados...</td></tr>`;
        try {
            const params = new URLSearchParams({ page, size: appState.empenhos.size });
            const data = await fetchWithAuth(`/empenhos?${params.toString()}`);
            appState.empenhos = data;
            if (data.results.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;">Nenhum empenho encontrado.</td></tr>`;
                document.getElementById('empenhos-pagination-container').innerHTML = ''; return;
            }
            tableBody.innerHTML = data.results.map(e => `
                <tr data-id="${e.id}">
                    <td>${e.numero_ne}</td><td>${e.nota_credito.numero_nc}</td><td>${e.secao_requisitante.nome}</td>
                    <td>${e.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>${new Date(e.data_empenho + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td class="actions">${currentUser.role === 'ADMINISTRADOR' ? `<button class="btn-icon btn-delete" data-action="delete-empenho" data-id="${e.id}" data-numero="${e.numero_ne}" title="Excluir Empenho"><i class="fas fa-trash"></i></button>` : 'N/A'}</td>
                </tr>`).join('');
            const paginationContainer = document.getElementById('empenhos-pagination-container');
            renderPagination(paginationContainer, data.total, data.page, data.size, (newPage) => loadEmpenhosTable(newPage));
        } catch (error) {
            tableBody.innerHTML = `<tr><td colspan="6" class="error-message">Erro ao carregar empenhos: ${error.message}</td></tr>`;
        }
    }
    
    function getEmpenhoFormHTML(empenho = {}, notasCredito, secoes) {
        const isEditing = !!empenho.id;
        const notasOptions = notasCredito.map(nc => `<option value="${nc.id}" ${nc.id === empenho.nota_credito_id ? 'selected' : ''}>${nc.numero_nc} (Saldo: ${nc.saldo_disponivel.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})</option>`).join('');
        const secoesOptions = secoes.map(s => `<option value="${s.id}" ${s.id === empenho.secao_requisitante_id ? 'selected' : ''}>${s.nome}</option>`).join('');
        return `
            <form id="empenho-form" data-id="${isEditing ? empenho.id : ''}" novalidate>
                <div class="form-grid">
                    <div class="form-field"><label for="numero_ne">Número do Empenho (NE)</label><input type="text" name="numero_ne" value="${empenho.numero_ne || ''}" required></div>
                    <div class="form-field"><label for="valor">Valor (R$)</label><input type="number" name="valor" step="0.01" min="0.01" value="${empenho.valor || ''}" required></div>
                    <div class="form-field"><label for="data_empenho">Data do Empenho</label><input type="date" name="data_empenho" value="${empenho.data_empenho || ''}" required></div>
                    <div class="form-field"><label for="nota_credito_id">Nota de Crédito Associada</label><select name="nota_credito_id" required>${notasOptions}</select></div>
                    <div class="form-field"><label for="secao_requisitante_id">Seção Requisitante</label><select name="secao_requisitante_id" required>${secoesOptions}</select></div>
                    <div class="form-field form-field-full"><label for="observacao">Observação</label><textarea name="observacao">${empenho.observacao || ''}</textarea></div>
                </div>
                <div id="form-feedback" class="modal-feedback" style="display: none;"></div>
                <div class="form-actions"><button type="submit" class="btn btn-primary">${isEditing ? 'Salvar Alterações' : 'Criar Empenho'}</button></div>
            </form>`;
    }
    
    async function handleEmpenhoFormSubmit(e, closeModalFunc) {
        e.preventDefault();
        const form = e.target;
        const submitButton = form.querySelector('button[type="submit"]');
        const feedbackContainer = form.querySelector('#form-feedback');
        if (!form.checkValidity()) {
            feedbackContainer.textContent = 'Por favor, preencha todos os campos obrigatórios.';
            feedbackContainer.style.display = 'block'; return;
        }
        submitButton.disabled = true; submitButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i> A salvar...`;
        feedbackContainer.style.display = 'none';
        const id = form.dataset.id;
        const method = id ? 'PUT' : 'POST', endpoint = id ? `/empenhos/${id}` : '/empenhos';
        const formData = new FormData(form), data = Object.fromEntries(formData.entries());
        data.valor = parseFloat(data.valor);
        data.nota_credito_id = parseInt(data.nota_credito_id);
        data.secao_requisitante_id = parseInt(data.secao_requisitante_id);
        try {
            await fetchWithAuth(endpoint, { method, body: JSON.stringify(data) });
            closeModalFunc();
            await loadEmpenhosTable(appState.empenhos.page);
        } catch (error) {
            feedbackContainer.textContent = `Erro ao salvar: ${error.message}`;
            feedbackContainer.style.display = 'block';
        } finally {
            submitButton.disabled = false;
            submitButton.innerHTML = id ? 'Salvar Alterações' : 'Criar Empenho';
        }
    }
    
    async function renderAdminView(container) {
        if (currentUser.role !== 'ADMINISTRADOR') {
            container.innerHTML = `<div class="card error-message">Acesso negado. Esta área é restrita a administradores.</div>`; return;
        }
        container.innerHTML = `
            <div class="view-header"><h1>Administração do Sistema</h1></div>
            <nav class="sub-nav">
                <button class="sub-tab-btn active" data-subview="secoes">Gerir Seções</button>
                <button class="sub-tab-btn" data-subview="users">Gerir Utilizadores</button>
                <button class="sub-tab-btn" data-subview="logs">Logs de Auditoria</button>
            </nav>
            <div id="admin-content-container"></div>`;
        const adminContentContainer = container.querySelector('#admin-content-container');
        container.querySelector('.sub-nav').addEventListener('click', (e) => {
            if (e.target.matches('.sub-tab-btn')) {
                const newSubView = e.target.dataset.subview;
                container.querySelectorAll('.sub-tab-btn').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
                renderAdminSubView(adminContentContainer, newSubView);
            }
        });
        await renderAdminSubView(adminContentContainer, 'secoes');
    }
    
    async function renderAdminSubView(container, subView) {
        container.innerHTML = `<div class="loading-spinner"><p>A carregar...</p></div>`;
        switch (subView) {
            case 'users': await renderAdminUsersView(container); break;
            case 'secoes': await renderAdminSeçõesView(container); break;
            case 'logs': await renderAdminLogsView(container); break;
            default: container.innerHTML = 'Selecione uma opção.';
        }
    }

    async function renderAdminSeçõesView(container) {
        container.innerHTML = `
            <div class="card">
                <h3>Gerir Seções</h3><p>Adicione, renomeie ou exclua seções da lista utilizada nos formulários.</p>
                <form id="secao-form" class="admin-form">
                    <input type="hidden" name="id"><input type="text" name="nome" placeholder="Nome da nova seção" required>
                    <button type="submit" class="btn btn-primary">Adicionar Seção</button>
                </form>
                <div class="table-container" style="margin-top: 1.5rem;">
                    <table id="secoes-table"><thead><tr><th>ID</th><th>Nome da Seção</th><th class="actions">Ações</th></tr></thead><tbody></tbody></table>
                </div>
            </div>`;
        await loadAndRenderSeçõesTable();
        container.querySelector('#secao-form').addEventListener('submit', handleSecaoFormSubmit);
    }

    async function loadAndRenderSeçõesTable() {
        const tableBody = document.querySelector('#secoes-table tbody');
        try {
            const secoes = await fetchWithAuth('/secoes');
            appState.secoes = secoes;
            tableBody.innerHTML = secoes.length === 0 ? '<tr><td colspan="3">Nenhuma seção registada.</td></tr>' : secoes.map(s => `
                <tr data-id="${s.id}">
                    <td>${s.id}</td><td>${s.nome}</td>
                    <td class="actions">
                        <button class="btn-icon" data-action="edit-secao" data-id="${s.id}" data-nome="${s.nome}" title="Editar"><i class="fas fa-edit"></i></button>
                        <button class="btn-icon btn-delete" data-action="delete-secao" data-id="${s.id}" data-nome="${s.nome}" title="Excluir"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>`).join('');
        } catch (error) {
            tableBody.innerHTML = `<tr><td colspan="3" class="error-message">Erro ao carregar seções: ${error.message}</td></tr>`;
        }
    }

    async function handleSecaoFormSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const id = form.id.value, nome = form.nome.value;
        const method = id ? 'PUT' : 'POST', endpoint = id ? `/secoes/${id}` : '/secoes';
        const submitButton = form.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        try {
            await fetchWithAuth(endpoint, { method, body: JSON.stringify({ nome }) });
            form.reset(); form.id.value = ''; submitButton.textContent = 'Adicionar Seção';
            await loadAndRenderSeçõesTable();
        } catch (error) {
            openModal('Erro ao Salvar', `<p>${error.message}</p>`);
        } finally {
            submitButton.disabled = false;
        }
    }

    async function renderAdminUsersView(container) {
        container.innerHTML = `
            <div class="card">
                <h3>Gerir Utilizadores</h3><p>Adicione novos utilizadores e defina os seus perfis de acesso.</p>
                <form id="user-form" class="admin-form-grid">
                    <input type="text" name="username" placeholder="Nome de utilizador" required><input type="email" name="email" placeholder="E-mail" required>
                    <input type="password" name="password" placeholder="Senha" required><select name="role" required><option value="OPERADOR">Operador</option><option value="ADMINISTRADOR">Administrador</option></select>
                    <button type="submit" class="btn btn-primary">Adicionar Utilizador</button>
                </form>
                <div id="form-feedback" class="modal-feedback" style="display: none; margin-top: 1rem;"></div>
                <div class="table-container" style="margin-top: 1.5rem;">
                    <table id="users-table"><thead><tr><th>ID</th><th>Utilizador</th><th>E-mail</th><th>Perfil</th><th class="actions">Ações</th></tr></thead><tbody></tbody></table>
                </div>
            </div>`;
        await loadAndRenderUsersTable();
        container.querySelector('#user-form').addEventListener('submit', handleUserFormSubmit);
    }

    async function loadAndRenderUsersTable() {
        const tableBody = document.querySelector('#users-table tbody');
        try {
            const users = await fetchWithAuth('/users');
            appState.users = users;
            tableBody.innerHTML = users.length === 0 ? '<tr><td colspan="5">Nenhum utilizador registado.</td></tr>' : users.map(u => `
                <tr data-id="${u.id}">
                    <td>${u.id}</td><td>${u.username}</td><td>${u.email}</td><td>${u.role}</td>
                    <td class="actions">${u.id === currentUser.id ? '<span>(Você)</span>' : `<button class="btn-icon btn-delete" data-action="delete-user" data-id="${u.id}" data-username="${u.username}" title="Excluir"><i class="fas fa-trash"></i></button>`}</td>
                </tr>`).join('');
        } catch (error) {
            tableBody.innerHTML = `<tr><td colspan="5" class="error-message">Erro ao carregar utilizadores: ${error.message}</td></tr>`;
        }
    }
    
    async function handleUserFormSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const submitButton = form.querySelector('button[type="submit"]');
        const feedbackContainer = document.querySelector('#form-feedback');
        submitButton.disabled = true; feedbackContainer.style.display = 'none';
        const data = Object.fromEntries(new FormData(form).entries());
        try {
            await fetchWithAuth('/users', { method: 'POST', body: JSON.stringify(data) });
            form.reset();
            await loadAndRenderUsersTable();
        } catch (error) {
            feedbackContainer.textContent = `Erro ao criar utilizador: ${error.message}`;
            feedbackContainer.style.display = 'block';
        } finally {
            submitButton.disabled = false;
        }
    }

    async function renderAdminLogsView(container) {
        container.innerHTML = `
            <div class="card">
                <h3>Log de Auditoria</h3><p>Registo de todas as ações importantes realizadas no sistema.</p>
                <div class="table-container" style="margin-top: 1.5rem;">
                    <table id="logs-table"><thead><tr><th>Data/Hora (UTC)</th><th>Utilizador</th><th>Ação</th><th>Detalhes</th></tr></thead><tbody></tbody></table>
                </div>
            </div>`;
        await loadAndRenderAuditLogsTable();
    }
    
    async function loadAndRenderAuditLogsTable() {
        const tableBody = document.querySelector('#logs-table tbody');
        tableBody.innerHTML = '<tr><td colspan="4">A carregar logs...</td></tr>';
        try {
            const logs = await fetchWithAuth(`/audit-logs?limit=100`);
            tableBody.innerHTML = logs.length === 0 ? '<tr><td colspan="4">Nenhum log de auditoria encontrado.</td></tr>' : logs.map(log => `
                <tr>
                    <td>${new Date(log.timestamp).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })}</td>
                    <td>${log.username}</td><td><span class="log-action">${log.action}</span></td><td>${log.details || ''}</td>
                </tr>`).join('');
        } catch (error) {
            tableBody.innerHTML = `<tr><td colspan="4" class="error-message">Erro ao carregar logs: ${error.message}</td></tr>`;
        }
    }

    appMain.addEventListener('click', async (e) => {
        const targetButton = e.target.closest('button.btn-icon');
        if (!targetButton) return;
        const { action, id } = targetButton.dataset;
        if (action === 'edit-nc') {
            try {
                const ncData = await fetchWithAuth(`/notas-credito/${id}`);
                const formHTML = getNotaCreditoFormHTML(ncData);
                openModal(`Editar Nota de Crédito: ${ncData.numero_nc}`, formHTML, (modal, close) => {
                    modal.querySelector('#nc-form').addEventListener('submit', (ev) => handleNcFormSubmit(ev, close));
                });
            } catch (error) {
                openModal('Erro', `<p>Não foi possível carregar os dados da NC: ${error.message}</p>`);
            }
        }
        if (action === 'delete-nc') {
            const numero = targetButton.dataset.numero;
            showConfirmationModal('Excluir Nota de Crédito', `Tem a certeza de que deseja excluir a NC "${numero}"?`, async () => {
                try {
                    await fetchWithAuth(`/notas-credito/${id}`, { method: 'DELETE' });
                    await loadNotasCreditoTable(appState.notasCredito.page);
                } catch (error) {
                    openModal('Erro ao Excluir', `<p>${error.message}</p>`);
                }
            });
        }
        if (action === 'delete-empenho') {
            const numero = targetButton.dataset.numero;
            showConfirmationModal('Excluir Empenho', `Tem a certeza de que deseja excluir o empenho "${numero}"?`, async () => {
                try {
                    await fetchWithAuth(`/empenhos/${id}`, { method: 'DELETE' });
                    await loadEmpenhosTable(appState.empenhos.page);
                } catch (error) {
                    openModal('Erro ao Excluir', `<p>${error.message}</p>`);
                }
            });
        }
        if (action === 'edit-secao') {
            const nome = targetButton.dataset.nome;
            const form = document.getElementById('secao-form');
            if(form) {
                form.id.value = id;
                form.nome.value = nome;
                form.querySelector('button[type="submit"]').textContent = 'Salvar Alterações';
            }
        }
        if (action === 'delete-secao') {
            const nome = targetButton.dataset.nome;
            showConfirmationModal('Excluir Seção', `Tem a certeza de que deseja excluir a seção "${nome}"?`, async () => {
                try {
                    await fetchWithAuth(`/secoes/${id}`, { method: 'DELETE' });
                    await loadAndRenderSeçõesTable();
                } catch (error) {
                    openModal('Erro ao Excluir', `<p>${error.message}</p>`);
                }
            });
        }
        if (action === 'delete-user') {
            const username = targetButton.dataset.username;
            showConfirmationModal('Excluir Utilizador', `Tem a certeza de que deseja excluir o utilizador "${username}"?`, async () => {
                try {
                    await fetchWithAuth(`/users/${id}`, { method: 'DELETE' });
                    await loadAndRenderUsersTable();
                } catch (error) {
                    openModal('Erro ao Excluir', `<p>${error.message}</p>`);
                }
            });
        }
    });

    // ========================================================================
    // 10. INICIALIZAÇÃO DA APLICAÇÃO
    // ========================================================================
    
    initApp();
});
