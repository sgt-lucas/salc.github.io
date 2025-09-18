// Este ficheiro está envolvido num IIFE (Immediately Invoked Function Expression)
// para evitar poluir o escopo global e organizar a aplicação.
(function () {
    document.addEventListener('DOMContentLoaded', () => {
        // ========================================================================
        // 1. CONFIGURAÇÃO INICIAL E ESTADO DA APLICAÇÃO
        // ========================================================================

        const API_URL = 'https://salc.onrender.com';
        let currentUser = null;
        
        const appState = {
            secoes: [],
            pis: [], 
            nds: [], 
            notasCredito: { total: 0, page: 1, size: 10, results: [] },
            empenhos: { total: 0, page: 1, size: 10, results: [] },
            users: [],
            auditLogs: [],
            currentFilters: { nc: {}, empenho: {} },
        };

        const DOM = {
            appNav: document.getElementById('app-nav'),
            appMain: document.getElementById('app-main'),
            usernameDisplay: document.getElementById('username-display'),
            logoutBtn: document.getElementById('logout-btn'),
            modalContainer: document.getElementById('modal-container'),
            modalTemplate: document.getElementById('modal-template'),
        };

        // ========================================================================
        // 2. MÓDULO DE SERVIÇOS DA API (apiService)
        // ========================================================================

        const apiService = {
            async fetch(endpoint, options = {}) {
                const token = localStorage.getItem('accessToken');
                const headers = {
                    'Authorization': `Bearer ${token}`,
                    ...(!options.isFormData && { 'Content-Type': 'application/json' }),
                    ...options.headers,
                };

                try {
                    const response = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
                    if (response.status === 401) {
                        app.logout();
                        throw new Error('Sessão expirada. Por favor, faça login novamente.');
                    }
                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        throw new Error(errorData.detail || `Erro ${response.status}: Falha na requisição`);
                    }
                    if (options.responseType === 'blob') return response.blob();
                    return response.status === 204 ? null : response.json();
                } catch (error) {
                    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
                        throw new Error('Erro de rede. Não foi possível conectar ao servidor.');
                    }
                    throw error;
                }
            },
            get: (endpoint) => apiService.fetch(endpoint),
            post: (endpoint, body) => apiService.fetch(endpoint, { method: 'POST', body: JSON.stringify(body) }),
            put: (endpoint, body) => apiService.fetch(endpoint, { method: 'PUT', body: JSON.stringify(body) }),
            delete: (endpoint) => apiService.fetch(endpoint, { method: 'DELETE' }),
            download: (endpoint) => apiService.fetch(endpoint, { responseType: 'blob' }),
        };

        // ========================================================================
        // 3. MÓDULO DE COMPONENTES DA UI (uiComponents)
        // ========================================================================

        const uiComponents = {
            openModal(title, contentHTML, onOpen) {
                const modalClone = DOM.modalTemplate.content.cloneNode(true);
                const modalBackdrop = modalClone.querySelector('.modal-backdrop');
                const modalElement = modalClone.querySelector('.modal');
                modalClone.querySelector('.modal-title').textContent = title;
                modalClone.querySelector('.modal-body').innerHTML = contentHTML;
                DOM.modalContainer.innerHTML = '';
                DOM.modalContainer.appendChild(modalClone);
                const closeModalFunc = () => { DOM.modalContainer.innerHTML = ''; };
                modalBackdrop.addEventListener('click', (e) => { if (e.target === modalBackdrop) closeModalFunc(); });
                modalElement.querySelector('.modal-close-btn').addEventListener('click', closeModalFunc);
                if (onOpen) onOpen(modalElement, closeModalFunc);
            },
            
            showConfirmationModal(title, message, onConfirm) {
                const contentHTML = `
                    <p>${message}</p>
                    <div class="form-actions" style="justify-content: flex-end; display: flex; gap: 1rem;">
                        <button id="confirm-cancel-btn" class="btn">Cancelar</button>
                        <button id="confirm-action-btn" class="btn btn-primary">Confirmar</button>
                    </div>`;
                this.openModal(title, contentHTML, (modalElement, closeModalFunc) => {
                    modalElement.querySelector('#confirm-action-btn').addEventListener('click', () => { onConfirm(); closeModalFunc(); });
                    modalElement.querySelector('#confirm-cancel-btn').addEventListener('click', closeModalFunc);
                });
            },
            
            renderPagination(container, { total, page, size }, onPageChange) {
                if (total <= size) { container.innerHTML = ''; return; }
                const totalPages = Math.ceil(total / size);
                const startItem = (page - 1) * size + 1;
                const endItem = Math.min(page * size, total);
                container.innerHTML = `<div class="pagination"><button id="prev-page-btn" class="btn" ${page === 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i> Anterior</button><span class="pagination-info">A exibir ${startItem}–${endItem} de ${total}</span><button id="next-page-btn" class="btn" ${page === totalPages ? 'disabled' : ''}>Próxima <i class="fas fa-chevron-right"></i></button></div>`;
                const prevBtn = container.querySelector('#prev-page-btn');
                const nextBtn = container.querySelector('#next-page-btn');
                if (prevBtn) prevBtn.addEventListener('click', () => onPageChange(page - 1));
                if (nextBtn) nextBtn.addEventListener('click', () => onPageChange(page + 1));
            },

            showLoading(container) {
                container.innerHTML = `<div class="loading-spinner"><p>A carregar...</p></div>`;
            },
            
            showError(container, error) {
                 container.innerHTML = `<div class="card error-message"><h3>Ocorreu um Erro</h3><p>${error.message}</p></div>`;
            },
        };

        // ========================================================================
        // 4. MÓDULO DE RENDERIZAÇÃO DE VIEWS (viewRenderer)
        // ========================================================================
        
        const viewRenderer = {
            async dashboard(container) {
                if (appState.secoes.length === 0) {
                    try { appState.secoes = await apiService.get('/secoes'); } 
                    catch (error) { console.error("Erro ao carregar seções:", error); }
                }
                if (appState.pis.length === 0) {
                    try { appState.pis = await apiService.get('/notas-credito/distinct/plano-interno'); }
                     catch (error) { console.error("Erro ao carregar Planos Internos:", error); }
                }
                if (appState.nds.length === 0) {
                    try { appState.nds = await apiService.get('/notas-credito/distinct/nd'); }
                     catch (error) { console.error("Erro ao carregar Naturezas de Despesa:", error); }
                }

                container.innerHTML = `
                    <div class="view-header"><h1>Dashboard</h1></div>
                    <div class="dashboard-grid dashboard-grid-3-cols">
                        <div class="card kpi-card"><h3>Saldo Disponível Total</h3><p id="kpi-saldo-total">A carregar...</p></div>
                        <div class="card kpi-card"><h3>NCs Ativas</h3><p id="kpi-ncs-ativas">A carregar...</p></div>
                        <div class="card kpi-card kpi-fake"><h3>Total Empenhado (FAKE)</h3><p id="kpi-valor-empenhado-fake">A carregar...</p></div>
                    </div>
                    <div class="card aviso-card"><h3><i class="fas fa-exclamation-triangle"></i> Avisos Importantes (Próximos 7 dias)</h3><div id="aviso-content">A carregar...</div></div>
                    <div class="card">
                        <div class="view-header">
                            <h3>Gerar Relatórios</h3>
                            <div class="report-buttons">
                                <button id="generate-report-excel-btn" class="btn"><i class="fas fa-file-excel"></i> Exportar para Excel</button>
                                <button id="generate-report-pdf-btn" class="btn btn-primary" style="margin-left: 1rem;"><i class="fas fa-file-pdf"></i> Gerar PDF</button>
                            </div>
                        </div>
                        <div class="filters">
                            <div class="filter-group"><label for="report-filter-pi">Plano Interno</label><select id="report-filter-pi"><option value="">Todos</option></select></div>
                            <div class="filter-group"><label for="report-filter-nd">Natureza de Despesa</label><select id="report-filter-nd"><option value="">Todas</option></select></div>
                            <div class="filter-group"><label for="report-filter-secao">Seção Responsável</label><select id="report-filter-secao"><option value="">Todas</option></select></div>
                            <div class="filter-group"><label for="report-filter-status">Status</label><select id="report-filter-status"><option value="">Todos</option><option value="Ativa">Ativa</option><option value="Totalmente Empenhada">Totalmente Empenhada</option></select></div>
                        </div>
                        <div class="form-field" style="margin-top: 1rem;"><input type="checkbox" id="report-incluir-detalhes" name="incluir-detalhes"><label for="report-incluir-detalhes" style="display: inline-block; margin-left: 0.5rem;">Incluir detalhes de empenhos e recolhimentos</label></div>
                    </div>`;

                const piSelect = container.querySelector('#report-filter-pi');
                const ndSelect = container.querySelector('#report-filter-nd');
                const secaoSelect = container.querySelector('#report-filter-secao');
                
                if (piSelect) piSelect.innerHTML = '<option value="">Todos</option>' + appState.pis.map(pi => `<option value="${pi}">${pi}</option>`).join('');
                if (ndSelect) ndSelect.innerHTML = '<option value="">Todas</option>' + appState.nds.map(nd => `<option value="${nd}">${nd}</option>`).join('');
                if (secaoSelect) secaoSelect.innerHTML = '<option value="">Todas</option>' + appState.secoes.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
                
                container.querySelector('#generate-report-pdf-btn').addEventListener('click', eventHandlers.reports.generatePdf);
                container.querySelector('#generate-report-excel-btn').addEventListener('click', eventHandlers.reports.generateExcel);
                
                try {
                    const [kpis, avisos] = await Promise.all([
                        apiService.get('/dashboard/kpis'), 
                        apiService.get('/dashboard/avisos')
                    ]);
                    document.getElementById('kpi-saldo-total').textContent = kpis.saldo_disponivel_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                    document.getElementById('kpi-valor-empenhado-fake').textContent = kpis.valor_total_empenhos_fake.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                    document.getElementById('kpi-ncs-ativas').textContent = kpis.ncs_ativas;

                    const avisoContainer = document.getElementById('aviso-content');
                    if (avisos.length > 0) {
                        avisoContainer.innerHTML = avisos.map(nc => {
                            const prazo = new Date(nc.prazo_empenho + 'T00:00:00');
                            const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
                            const diffDays = Math.ceil((prazo - hoje) / (1000 * 60 * 60 * 24));
                            let avisoTexto = diffDays > 1 ? `Vence em ${diffDays} dias` : diffDays === 1 ? `Vence amanhã` : diffDays === 0 ? `Vence hoje` : `Venceu há ${Math.abs(diffDays)} dia(s)`;
                            return `<div class="aviso-item"><strong>NC ${nc.numero_nc}</strong> (PI: ${nc.plano_interno}, ND: ${nc.nd}): ${avisoTexto} (${prazo.toLocaleDateString('pt-BR')})</div>`;
                        }).join('');
                    } else {
                        avisoContainer.innerHTML = '<p>Nenhum aviso no momento.</p>';
                    }
                } catch (error) {
                    console.error("Erro ao carregar dados do dashboard:", error);
                    ['kpi-saldo-total', 'kpi-valor-empenhado-fake', 'kpi-ncs-ativas'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.textContent = 'Erro';
                    });
                    const avisoEl = document.getElementById('aviso-content');
                    if(avisoEl) avisoEl.innerHTML = `<p class="error-message">Não foi possível carregar os avisos: ${error.message}</p>`;
                }
            },
            
            async notasCredito(container, page = 1) {
                container.innerHTML = `
                    <div class="view-header">
                        <h1>Gestão de Notas de Crédito</h1>
                        <div>
                            <button id="export-nc-btn" class="btn"><i class="fas fa-file-excel"></i> Exportar para Excel</button>
                            <button id="add-nc-btn" class="btn btn-primary" style="margin-left: 1rem;"><i class="fas fa-plus"></i> Adicionar Nova NC</button>
                        </div>
                    </div>
                    <div class="filters card">
                        <div class="filter-group"><label for="filter-pi">Plano Interno</label><select id="filter-pi"><option value="">Todos</option></select></div>
                        <div class="filter-group"><label for="filter-nd">Natureza de Despesa</label><select id="filter-nd"><option value="">Todas</option></select></div>
                        <div class="filter-group"><label for="filter-secao">Seção Responsável</label><select id="filter-secao"><option value="">Todas</option></select></div>
                        <div class="filter-group"><label for="filter-status">Status</label><select id="filter-status"><option value="">Todos</option><option value="Ativa">Ativa</option><option value="Totalmente Empenhada">Totalmente Empenhada</option></select></div>
                        <button id="apply-filters-btn" class="btn">Aplicar Filtros</button>
                    </div>
                    <div class="table-container card"><table id="nc-table"><thead><tr><th>Nº da NC</th><th>Plano Interno</th><th>ND</th><th>Seção</th><th>Valor Original</th><th>Saldo Disponível</th><th>Prazo</th><th>Status</th><th class="actions">Ações</th></tr></thead><tbody></tbody></table></div>
                    <div id="nc-pagination-container"></div>`;
                
                const piSelect = container.querySelector('#filter-pi');
                const ndSelect = container.querySelector('#filter-nd');
                const secaoSelect = container.querySelector('#filter-secao');
                
                if (piSelect) piSelect.innerHTML = '<option value="">Todos</option>' + appState.pis.map(pi => `<option value="${pi}">${pi}</option>`).join('');
                if (ndSelect) ndSelect.innerHTML = '<option value="">Todas</option>' + appState.nds.map(nd => `<option value="${nd}">${nd}</option>`).join('');
                if (secaoSelect) secaoSelect.innerHTML = '<option value="">Todas</option>' + appState.secoes.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
                
                container.querySelector('#filter-pi').value = appState.currentFilters.nc.plano_interno || '';
                container.querySelector('#filter-nd').value = appState.currentFilters.nc.nd || '';
                container.querySelector('#filter-secao').value = appState.currentFilters.nc.secao_responsavel_id || '';
                container.querySelector('#filter-status').value = appState.currentFilters.nc.status || '';
                
                await this.loadNotasCreditoTable(page);
                
                container.querySelector('#apply-filters-btn').addEventListener('click', () => {
                    appState.currentFilters.nc = {
                        plano_interno: container.querySelector('#filter-pi').value,
                        nd: container.querySelector('#filter-nd').value,
                        secao_responsavel_id: container.querySelector('#filter-secao').value,
                        status: container.querySelector('#filter-status').value,
                    };
                    this.loadNotasCreditoTable(1);
                });
                container.querySelector('#add-nc-btn').addEventListener('click', eventHandlers.notasCredito.openAddModal);
                container.querySelector('#export-nc-btn').addEventListener('click', () => eventHandlers.reports.exportToExcel('notas-credito'));
            },

            async loadNotasCreditoTable(page = 1) {
                const tableBody = document.querySelector('#nc-table tbody');
                if (!tableBody) return;
                tableBody.innerHTML = `<tr><td colspan="9" style="text-align:center;">A buscar dados...</td></tr>`;
                try {
                    const cleanFilters = Object.fromEntries(Object.entries(appState.currentFilters.nc).filter(([_, v]) => v != ''));
                    const params = new URLSearchParams({ page, size: appState.notasCredito.size, ...cleanFilters });
                    const data = await apiService.get(`/notas-credito?${params.toString()}`);
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
                                <button class="btn-icon" data-action="view-extrato" data-id="${nc.id}" title="Ver Extrato"><i class="fas fa-eye"></i></button>
                                <button class="btn-icon" data-action="edit-nc" data-id="${nc.id}" title="Editar NC"><i class="fas fa-edit"></i></button>
                                ${currentUser.role === 'ADMINISTRADOR' ? `<button class="btn-icon btn-delete" data-action="delete-nc" data-id="${nc.id}" data-numero="${nc.numero_nc}" title="Excluir NC"><i class="fas fa-trash"></i></button>` : ''}
                            </td>
                        </tr>`).join('');
                    uiComponents.renderPagination(document.getElementById('nc-pagination-container'), data, (newPage) => this.loadNotasCreditoTable(newPage));
                } catch (error) {
                    tableBody.innerHTML = `<tr><td colspan="9" class="error-message">Erro ao carregar dados: ${error.message}</td></tr>`;
                }
            },
            
            async empenhos(container, page = 1) {
                container.innerHTML = `
                    <div class="view-header">
                        <h1>Gestão de Empenhos</h1>
                        <div>
                            <button id="export-empenho-btn" class="btn"><i class="fas fa-file-excel"></i> Exportar para Excel</button>
                            <button id="add-empenho-btn" class="btn btn-primary" style="margin-left: 1rem;"><i class="fas fa-plus"></i> Novo Empenho</button>
                        </div>
                    </div>
                    <div class="table-container card"><table id="empenhos-table"><thead><tr><th>Nº do Empenho</th><th>Nº da NC Associada</th><th>Seção Requisitante</th><th>Valor do Saldo</th><th>Status</th><th>Data</th><th class="actions">Ações</th></tr></thead><tbody></tbody></table></div>
                    <div id="empenhos-pagination-container"></div>`;
                
                await this.loadEmpenhosTable(page);
                container.querySelector('#add-empenho-btn').addEventListener('click', eventHandlers.empenhos.openAddModal);
                container.querySelector('#export-empenho-btn').addEventListener('click', () => eventHandlers.reports.exportToExcel('empenhos'));
            },

            async loadEmpenhosTable(page = 1) {
                const tableBody = document.querySelector('#empenhos-table tbody');
                if (!tableBody) return;
                tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;">A buscar dados...</td></tr>`;
                try {
                    const params = new URLSearchParams({ page, size: appState.empenhos.size });
                    const data = await apiService.get(`/empenhos?${params.toString()}`);
                    appState.empenhos = data;
                    if (data.results.length === 0) {
                        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;">Nenhum empenho encontrado.</td></tr>`;
                        document.getElementById('empenhos-pagination-container').innerHTML = ''; return;
                    }
                    tableBody.innerHTML = data.results.map(e => {
                        const statusClass = e.status ? `status-${e.status.toLowerCase().replace(/ /g, '-')}` : 'status-ok';
                        const statusText = e.status || (e.is_fake ? 'FAKE' : 'OK');
                        const fakeClass = e.is_fake ? 'empenho-fake' : '';

                        return `
                        <tr data-id="${e.id}" class="${fakeClass}">
                            <td>${e.numero_ne}</td><td>${e.nota_credito.numero_nc}</td><td>${e.secao_requisitante.nome}</td>
                            <td>${e.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                            <td><span class="status ${statusClass}">${statusText}</span></td>
                            <td>${new Date(e.data_empenho + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                            <td class="actions">
                                <button class="btn btn-anular" data-action="add-anulacao" data-id="${e.id}" data-numero="${e.numero_ne}">Anular NE</button>
                                ${currentUser.role === 'ADMINISTRADOR' ? `<button class="btn-icon btn-delete" data-action="delete-empenho" data-id="${e.id}" data-numero="${e.numero_ne}" title="Excluir Empenho" style="margin-left: 0.5rem;"><i class="fas fa-trash"></i></button>` : ''}
                            </td>
                        </tr>`;
                    }).join('');
                     uiComponents.renderPagination(document.getElementById('empenhos-pagination-container'), data, (newPage) => this.loadEmpenhosTable(newPage));
                } catch (error) {
                    tableBody.innerHTML = `<tr><td colspan="7" class="error-message">Erro ao carregar empenhos: ${error.message}</td></tr>`;
                }
            },

            async admin(container) {
                if (currentUser.role !== 'ADMINISTRADOR') {
                    uiComponents.showError(container, new Error("Acesso negado. Esta área é restrita a administradores."));
                    return;
                }
                container.innerHTML = `<div class="view-header"><h1>Administração do Sistema</h1></div><nav class="sub-nav"><button class="sub-tab-btn active" data-subview="secoes">Gerir Seções</button><button class="sub-tab-btn" data-subview="users">Gerir Utilizadores</button><button class="sub-tab-btn" data-subview="logs">Logs de Auditoria</button></nav><div id="admin-content-container"></div>`;
                const adminContentContainer = container.querySelector('#admin-content-container');
                container.querySelector('.sub-nav').addEventListener('click', (e) => {
                    if (e.target.matches('.sub-tab-btn')) {
                        container.querySelectorAll('.sub-tab-btn').forEach(btn => btn.classList.remove('active'));
                        e.target.classList.add('active');
                        this.adminSubView(adminContentContainer, e.target.dataset.subview);
                    }
                });
                await this.adminSubView(adminContentContainer, 'secoes');
            },

            async adminSubView(container, subView) {
                 uiComponents.showLoading(container);
                try {
                    switch (subView) {
                        case 'users':
                             container.innerHTML = `
                                <div class="card"><h3>Gerir Utilizadores</h3><p>Adicione novos utilizadores e defina os seus perfis de acesso.</p>
                                <form id="user-form" class="admin-form-grid">
                                    <input type="text" name="username" placeholder="Nome de utilizador" required>
                                    <input type="email" name="email" placeholder="E-mail" required>
                                    <input type="password" name="password" placeholder="Senha" required>
                                    <select name="role" required><option value="OPERADOR">Operador</option><option value="ADMINISTRADOR">Administrador</option></select>
                                    <button type="submit" class="btn btn-primary">Adicionar Utilizador</button>
                                </form>
                                <div id="form-feedback" class="modal-feedback" style="display: none; margin-top: 1rem;"></div>
                                <div class="table-container" style="margin-top: 1.5rem;"><table id="users-table"><thead><tr><th>ID</th><th>Utilizador</th><th>E-mail</th><th>Perfil</th><th class="actions">Ações</th></tr></thead><tbody></tbody></table></div></div>`;
                            const users = await apiService.get('/users');
                            const userTableBody = container.querySelector('#users-table tbody');
                            userTableBody.innerHTML = users.map(u => `<tr><td>${u.id}</td><td>${u.username}</td><td>${u.email}</td><td>${u.role}</td><td class="actions">${u.id === currentUser.id ? '<span>(Você)</span>' : `<button class="btn-icon btn-delete" data-action="delete-user" data-id="${u.id}" data-username="${u.username}" title="Excluir"><i class="fas fa-trash"></i></button>`}</td></tr>`).join('');
                            container.querySelector('#user-form').addEventListener('submit', eventHandlers.admin.handleUserFormSubmit);
                            break;
                        case 'secoes':
                            container.innerHTML = `
                                <div class="card"><h3>Gerir Seções</h3><p>Adicione, renomeie ou exclua seções da lista utilizada nos formulários.</p>
                                <form id="secao-form" class="admin-form">
                                    <input type="hidden" name="id"><input type="text" name="nome" placeholder="Nome da nova seção" required>
                                    <button type="submit" class="btn btn-primary">Adicionar Seção</button></form>
                                <div class="table-container" style="margin-top: 1.5rem;"><table id="secoes-table"><thead><tr><th>ID</th><th>Nome da Seção</th><th class="actions">Ações</th></tr></thead><tbody></tbody></table></div></div>`;
                            const secoes = await apiService.get('/secoes');
                            appState.secoes = secoes;
                            const secaoTableBody = container.querySelector('#secoes-table tbody');
                            secaoTableBody.innerHTML = secoes.map(s => `<tr><td>${s.id}</td><td>${s.nome}</td><td class="actions"><button class="btn-icon" data-action="edit-secao" data-id="${s.id}" data-nome="${s.nome}" title="Editar"><i class="fas fa-edit"></i></button><button class="btn-icon btn-delete" data-action="delete-secao" data-id="${s.id}" data-nome="${s.nome}" title="Excluir"><i class="fas fa-trash"></i></button></td></tr>`).join('');
                            container.querySelector('#secao-form').addEventListener('submit', eventHandlers.admin.handleSecaoFormSubmit);
                            break;
                        case 'logs':
                             container.innerHTML = `
                                <div class="card"><h3>Log de Auditoria</h3><p>Registo de todas as ações importantes realizadas no sistema.</p>
                                <div class="table-container" style="margin-top: 1.5rem;"><table id="logs-table"><thead><tr><th>Data/Hora (UTC)</th><th>Utilizador</th><th>Ação</th><th>Detalhes</th></tr></thead><tbody></tbody></table></div></div>`;
                            const logs = await apiService.get('/audit-logs?limit=100');
                            const logTableBody = container.querySelector('#logs-table tbody');
                            logTableBody.innerHTML = logs.map(log => `<tr><td>${new Date(log.timestamp).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })}</td><td>${log.username}</td><td><span class="log-action">${log.action}</span></td><td>${log.details || ''}</td></tr>`).join('');
                            break;
                    }
                } catch (error) {
                    uiComponents.showError(container, error);
                }
            },
        };
        
        // ========================================================================
        // 5. MÓDULO DE MANIPULADORES DE EVENTOS (eventHandlers)
        // ========================================================================

        const eventHandlers = {
            async handleMainClick(e) {
                const targetButton = e.target.closest('button[data-action]');
                if (!targetButton) return;
                const { action, id, numero, nome, username } = targetButton.dataset;

                switch(action) {
                    case 'view-extrato': this.notasCredito.showExtratoModal(id); break;
                    case 'edit-nc': this.notasCredito.openEditModal(id); break;
                    case 'delete-nc': this.notasCredito.delete(id, numero); break;
                    case 'delete-empenho': this.empenhos.delete(id, numero); break;
                    case 'add-anulacao': this.empenhos.openAnulacaoModal(id, numero); break;
                    case 'edit-secao': this.admin.editSecao(id, nome); break;
                    case 'delete-secao': this.admin.deleteSecao(id, nome); break;
                    case 'delete-user': this.admin.deleteUser(id, username); break;
                }
            },

            notasCredito: {
                openAddModal() {
                    const formHTML = eventHandlers.getNotaCreditoFormHTML();
                    uiComponents.openModal('Adicionar Nova Nota de Crédito', formHTML, (modal, close) => {
                        modal.querySelector('#nc-form').addEventListener('submit', (e) => eventHandlers.notasCredito.handleFormSubmit(e, close));
                    });
                },
                
                async openEditModal(id) {
                    try {
                        const ncData = await apiService.get(`/notas-credito/${id}`);
                        const formHTML = eventHandlers.getNotaCreditoFormHTML(ncData);
                        uiComponents.openModal(`Editar Nota de Crédito: ${ncData.numero_nc}`, formHTML, (modal, close) => {
                            modal.querySelector('#nc-form').addEventListener('submit', (ev) => eventHandlers.notasCredito.handleFormSubmit(ev, close));
                        });
                    } catch (error) {
                        uiComponents.openModal('Erro', `<p>Não foi possível carregar os dados da NC: ${error.message}</p>`);
                    }
                },
                
                async handleFormSubmit(e, closeModalFunc) {
                    e.preventDefault();
                    const form = e.target, btn = form.querySelector('button[type="submit"]'), feedback = form.querySelector('#form-feedback');
                    if (!form.checkValidity()) { feedback.textContent = 'Por favor, preencha todos os campos obrigatórios corretamente.'; feedback.style.display = 'block'; return; }
                    if (form.elements.prazo_empenho.value < form.elements.data_chegada.value) { feedback.textContent = 'O prazo para empenho não pode ser anterior à data de chegada.'; feedback.style.display = 'block'; return; }
                    
                    btn.disabled = true; btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> A salvar...`; feedback.style.display = 'none';
                    const id = form.dataset.id;
                    const method = id ? 'put' : 'post', endpoint = id ? `/notas-credito/${id}` : '/notas-credito';
                    const data = Object.fromEntries(new FormData(form));
                    data.valor = parseFloat(data.valor); data.secao_responsavel_id = parseInt(data.secao_responsavel_id);
                    
                    try {
                        await apiService[method](endpoint, data);
                        closeModalFunc();
                        await viewRenderer.loadNotasCreditoTable(appState.notasCredito.page);
                    } catch (error) {
                        feedback.textContent = `Erro ao salvar: ${error.message}`; feedback.style.display = 'block';
                    } finally {
                        btn.disabled = false; btn.innerHTML = id ? 'Salvar Alterações' : 'Criar Nota de Crédito';
                    }
                },

                delete(id, numero) {
                    uiComponents.showConfirmationModal('Excluir Nota de Crédito', `Tem a certeza de que deseja excluir a NC "${numero}"?`, async () => {
                        try {
                            await apiService.delete(`/notas-credito/${id}`);
                            await viewRenderer.loadNotasCreditoTable(appState.notasCredito.page);
                        } catch (error) {
                            uiComponents.openModal('Erro ao Excluir', `<p>${error.message}</p>`);
                        }
                    });
                },

                async showExtratoModal(id) {
                    uiComponents.openModal('Extrato da Nota de Crédito', '<div class="loading-spinner"><p>A carregar extrato...</p></div>');
                    try {
                        const nc = await apiService.get(`/notas-credito/${id}`);
                        const empenhosData = await apiService.get(`/empenhos?nota_credito_id=${id}&size=1000`);
                        const recolhimentos = await apiService.get(`/recolhimentos-saldo?nota_credito_id=${id}`);
                        
                        const anulacoesPromises = empenhosData.results.map(e => apiService.get(`/anulacoes-empenho?empenho_id=${e.id}`));
                        const allAnulacoesArrays = await Promise.all(anulacoesPromises);
                        const allAnulacoes = allAnulacoesArrays.flat();

                        const empenhosMap = new Map(empenhosData.results.map(e => [e.id, e.numero_ne]));

                        const empenhosHTML = empenhosData.results.length > 0 ? empenhosData.results.map(e => `<tr><td>${e.numero_ne}</td><td>${e.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td><td>${new Date(e.data_empenho + 'T00:00:00').toLocaleDateString('pt-BR')}</td><td>${e.observacao || ''}</td></tr>`).join('') : '<tr><td colspan="4">Nenhum empenho associado.</td></tr>';
                        const recolhimentosHTML = recolhimentos.length > 0 ? recolhimentos.map(r => `<tr><td>${r.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td><td>${new Date(r.data + 'T00:00:00').toLocaleDateString('pt-BR')}</td><td>${r.observacao || ''}</td></tr>`).join('') : '<tr><td colspan="3">Nenhum recolhimento registado.</td></tr>';
                        const anulacoesHTML = allAnulacoes.length > 0 ? allAnulacoes.map(a => `<tr><td>${empenhosMap.get(a.empenho_id) || 'N/A'}</td><td>${a.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td><td>${new Date(a.data + 'T00:00:00').toLocaleDateString('pt-BR')}</td><td>${a.observacao || ''}</td></tr>`).join('') : '<tr><td colspan="4">Nenhuma anulação registada.</td></tr>';
                        
                        const contentHTML = `
                            <div id="extrato-content">
                                <h4>Detalhes da NC ${nc.numero_nc}</h4>
                                <p><strong>Plano Interno:</strong> ${nc.plano_interno} | <strong>ND:</strong> ${nc.nd} | <strong>Seção:</strong> ${nc.secao_responsavel.nome}</p>
                                <p><strong>Valor Original:</strong> ${nc.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} | <strong>Saldo Disponível:</strong> ${nc.saldo_disponivel.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                                <hr style="margin: 1rem 0;"><h4>Empenhos Associados</h4><div class="table-container" style="max-height: 150px; overflow-y: auto;"><table><thead><tr><th>Nº do Empenho</th><th>Valor</th><th>Data</th><th>Observação</th></tr></thead><tbody>${empenhosHTML}</tbody></table></div>
                                <hr style="margin: 1rem 0;"><div style="display: flex; justify-content: space-between; align-items: center;"><h4>Recolhimentos de Saldo</h4><button class="btn" data-action="add-recolhimento" data-id="${id}"><i class="fas fa-plus"></i> Adicionar</button></div><div class="table-container" style="max-height: 150px; overflow-y: auto;"><table><thead><tr><th>Valor</th><th>Data</th><th>Observação</th></tr></thead><tbody>${recolhimentosHTML}</tbody></table></div>
                                <hr style="margin: 1rem 0;"><h4>Anulações de Empenho (Histórico)</h4><div class="table-container" style="max-height: 150px; overflow-y: auto;"><table><thead><tr><th>Nº do Empenho</th><th>Valor</th><th>Data</th><th>Observação</th></tr></thead><tbody>${anulacoesHTML}</tbody></table></div>
                            </div>`;
                        
                        uiComponents.openModal(`Extrato da Nota de Crédito ${nc.numero_nc}`, contentHTML);

                    } catch (error) {
                        uiComponents.openModal('Erro', `<p>Não foi possível carregar o extrato: ${error.message}</p>`);
                    }
                }
            },

            getNotaCreditoFormHTML(nc = {}) {
                const isEditing = !!nc.id;
                const secoesOptions = appState.secoes.map(s => `<option value="${s.id}" ${s.id === nc.secao_responsavel_id ? 'selected' : ''}>${s.nome}</option>`).join('');
                return `<form id="nc-form" data-id="${isEditing ? nc.id : ''}" novalidate><div class="form-grid"><div class="form-field"><label for="numero_nc">Número da NC</label><input type="text" name="numero_nc" value="${nc.numero_nc || ''}" required></div><div class="form-field"><label for="valor">Valor (R$)</label><input type="number" name="valor" step="0.01" value="${nc.valor || ''}" required min="0.01"></div><div class="form-field"><label for="secao_responsavel_id">Seção Responsável</label><select name="secao_responsavel_id" required>${secoesOptions}</select></div><div class="form-field"><label for="plano_interno">Plano Interno</label><input type="text" name="plano_interno" value="${nc.plano_interno || ''}" required></div><div class="form-field"><label for="nd">Natureza de Despesa</label><input type="text" name="nd" value="${nc.nd || ''}" required pattern="\\d{6}" title="Deve conter 6 dígitos numéricos."></div><div class="form-field"><label for="ptres">PTRES</label><input type="text" name="ptres" value="${nc.ptres || ''}" required maxlength="6"></div><div class="form-field"><label for="fonte">Fonte</label><input type="text" name="fonte" value="${nc.fonte || ''}" required maxlength="10"></div><div class="form-field"><label for="esfera">Esfera</label><input type="text" name="esfera" value="${nc.esfera || ''}" required></div><div class="form-field"><label for="data_chegada">Data de Chegada</label><input type="date" name="data_chegada" value="${nc.data_chegada || ''}" required></div><div class="form-field"><label for="prazo_empenho">Prazo para Empenho</label><input type="date" name="prazo_empenho" value="${nc.prazo_empenho || ''}" required></div><div class="form-field form-field-full"><label for="descricao">Descrição</label><textarea name="descricao">${nc.descricao || ''}</textarea></div></div><div id="form-feedback" class="modal-feedback" style="display: none;"></div><div class="form-actions"><button type="submit" class="btn btn-primary">${isEditing ? 'Salvar Alterações' : 'Criar Nota de Crédito'}</button></div></form>`;
            },

            empenhos: {
                async openAddModal() {
                    try {
                        const [notasData, secoes] = await Promise.all([
                            apiService.get('/notas-credito?size=1000&status=Ativa'), 
                            apiService.get('/secoes')
                        ]);
                        const formHTML = eventHandlers.getEmpenhoFormHTML({}, notasData.results, secoes);
                        uiComponents.openModal('Novo Empenho', formHTML, (modal, close) => {
                            modal.querySelector('#empenho-form').addEventListener('submit', (e) => this.handleFormSubmit(e, close));
                        });
                    } catch (error) {
                        uiComponents.openModal('Erro', `<p>Não foi possível carregar os dados para o formulário: ${error.message}</p>`);
                    }
                },
                
                async handleFormSubmit(e, closeModalFunc) {
                    e.preventDefault();
                    const form = e.target, btn = form.querySelector('button[type="submit"]'), feedback = form.querySelector('#form-feedback');
                    if (!form.checkValidity()) { feedback.textContent = 'Por favor, preencha todos os campos obrigatórios.'; feedback.style.display = 'block'; return; }
                    
                    btn.disabled = true; btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> A salvar...`; feedback.style.display = 'none';
                    const id = form.dataset.id;
                    const method = id ? 'put' : 'post', endpoint = id ? `/empenhos/${id}` : '/empenhos';
                    
                    const formData = new FormData(form);
                    const data = Object.fromEntries(formData);
                    data.valor = parseFloat(data.valor);
                    data.nota_credito_id = parseInt(data.nota_credito_id);
                    data.secao_requisitante_id = parseInt(data.secao_requisitante_id);
                    data.is_fake = formData.has('is_fake'); // Corrigido para verificar se a checkbox existe
                    
                    try {
                        await apiService[method](endpoint, data);
                        closeModalFunc();
                        await viewRenderer.loadEmpenhosTable(appState.empenhos.page);
                    } catch (error) {
                        feedback.textContent = `Erro ao salvar: ${error.message}`; feedback.style.display = 'block';
                    } finally {
                        btn.disabled = false; btn.innerHTML = id ? 'Salvar Alterações' : 'Criar Empenho';
                    }
                },


                delete(id, numero) {
                    uiComponents.showConfirmationModal('Excluir Empenho', `Tem a certeza de que deseja excluir o empenho "${numero}"?`, async () => {
                        try {
                            await apiService.delete(`/empenhos/${id}`);
                            await viewRenderer.loadEmpenhosTable(appState.empenhos.page);
                        } catch (error) {
                            uiComponents.openModal('Erro ao Excluir', `<p>${error.message}</p>`);
                        }
                    });
                },
                
                openAnulacaoModal(empenhoId, numeroNe) {
                    const formHTML = `<form id="anulacao-form"><div class="form-grid"><div class="form-field"><label for="valor">Valor a Anular (R$)</label><input type="number" name="valor" step="0.01" min="0.01" required></div><div class="form-field"><label for="data">Data</label><input type="date" name="data" required></div><div class="form-field form-field-full"><label for="observacao">Observação</label><textarea name="observacao"></textarea></div></div><div id="form-feedback" class="modal-feedback" style="display: none;"></div><div class="form-actions"><button type="submit" class="btn btn-primary">Registar Anulação</button></div></form>`;
                    uiComponents.openModal(`Anular Empenho ${numeroNe}`, formHTML, (modal, close) => {
                        modal.querySelector('#anulacao-form').addEventListener('submit', async (ev) => {
                            ev.preventDefault();
                            const form = ev.target, btn = form.querySelector('button'), feedback = form.querySelector('#form-feedback');
                            btn.disabled = true; feedback.style.display = 'none';
                            const data = Object.fromEntries(new FormData(form));
                            data.valor = parseFloat(data.valor);
                            data.empenho_id = parseInt(empenhoId);
                            try {
                                await apiService.post('/anulacoes-empenho', data);
                                close();
                                await viewRenderer.loadEmpenhosTable(appState.empenhos.page);
                            } catch(error) {
                                feedback.textContent = error.message; feedback.style.display = 'block';
                                btn.disabled = false;
                            }
                        });
                    });
                },
            },
            
            getEmpenhoFormHTML(empenho = {}, notasCredito, secoes) {
                const isEditing = !!empenho.id;
                const notasOptions = notasCredito.map(nc => `<option value="${nc.id}" ${nc.id === empenho.nota_credito_id ? 'selected' : ''}>${nc.numero_nc} (Saldo: ${nc.saldo_disponivel.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})</option>`).join('');
                const secoesOptions = secoes.map(s => `<option value="${s.id}" ${s.id === empenho.secao_requisitante_id ? 'selected' : ''}>${s.nome}</option>`).join('');
                return `<form id="empenho-form" data-id="${isEditing ? empenho.id : ''}" novalidate><div class="form-grid">
                            <div class="form-field"><label for="numero_ne">Número do Empenho (NE)</label><input type="text" name="numero_ne" value="${empenho.numero_ne || ''}" required></div>
                            <div class="form-field"><label for="valor">Valor (R$)</label><input type="number" name="valor" step="0.01" min="0.01" value="${empenho.valor || ''}" required></div>
                            <div class="form-field"><label for="data_empenho">Data do Empenho</label><input type="date" name="data_empenho" value="${empenho.data_empenho || ''}" required></div>
                            <div class="form-field"><label for="nota_credito_id">Nota de Crédito Associada</label><select name="nota_credito_id" required>${notasOptions}</select></div>
                            <div class="form-field"><label for="secao_requisitante_id">Seção Requisitante</label><select name="secao_requisitante_id" required>${secoesOptions}</select></div>
                            <div class="form-field" style="align-self: center;"><input type="checkbox" id="is_fake" name="is_fake" ${empenho.is_fake ? 'checked' : ''}><label for="is_fake" style="display: inline-block; margin-left: 0.5rem;">Este empenho é FAKE</label></div>
                            <div class="form-field form-field-full"><label for="observacao">Observação</label><textarea name="observacao">${empenho.observacao || ''}</textarea></div>
                        </div>
                        <div id="form-feedback" class="modal-feedback" style="display: none;"></div>
                        <div class="form-actions"><button type="submit" class="btn btn-primary">${isEditing ? 'Salvar Alterações' : 'Criar Empenho'}</button></div>
                        </form>`;
            },

            admin: {
                 async handleUserFormSubmit(e) {
                    e.preventDefault();
                    const form = e.target, btn = form.querySelector('button[type="submit"]'), feedback = document.querySelector('#form-feedback');
                    btn.disabled = true; feedback.style.display = 'none';
                    const data = Object.fromEntries(new FormData(form));
                    try {
                        await apiService.post('/users', data);
                        form.reset();
                        await viewRenderer.adminSubView(document.getElementById('admin-content-container'), 'users');
                    } catch (error) {
                        feedback.textContent = `Erro ao criar utilizador: ${error.message}`;
                        feedback.style.display = 'block';
                    } finally {
                        btn.disabled = false;
                    }
                },
                
                async handleSecaoFormSubmit(e) {
                    e.preventDefault();
                    const form = e.target, id = form.id.value, nome = form.nome.value, btn = form.querySelector('button[type="submit"]');
                    const method = id ? 'put' : 'post', endpoint = id ? `/secoes/${id}` : '/secoes';
                    btn.disabled = true;
                    try {
                        await apiService[method](endpoint, { nome });
                        form.reset(); form.id.value = ''; btn.textContent = 'Adicionar Seção';
                        await viewRenderer.adminSubView(document.getElementById('admin-content-container'), 'secoes');
                    } catch (error) {
                        uiComponents.openModal('Erro ao Salvar', `<p>${error.message}</p>`);
                    } finally {
                        btn.disabled = false;
                    }
                },

                editSecao(id, nome) {
                     const form = document.getElementById('secao-form');
                    if(form) {
                        form.id.value = id;
                        form.nome.value = nome;
                        form.querySelector('button[type="submit"]').textContent = 'Salvar Alterações';
                    }
                },
                
                deleteSecao(id, nome) {
                     uiComponents.showConfirmationModal('Excluir Seção', `Tem a certeza de que deseja excluir a seção "${nome}"?`, async () => {
                        try {
                            await apiService.delete(`/secoes/${id}`);
                            await viewRenderer.adminSubView(document.getElementById('admin-content-container'), 'secoes');
                        } catch (error) {
                            uiComponents.openModal('Erro ao Excluir', `<p>${error.message}</p>`);
                        }
                    });
                },
                
                deleteUser(id, username) {
                     uiComponents.showConfirmationModal('Excluir Utilizador', `Tem a certeza de que deseja excluir o utilizador "${username}"?`, async () => {
                        try {
                            await apiService.delete(`/users/${id}`);
                            await viewRenderer.adminSubView(document.getElementById('admin-content-container'), 'users');
                        } catch (error) {
                            uiComponents.openModal('Erro ao Excluir', `<p>${error.message}</p>`);
                        }
                    });
                },
            },
            
            reports: {
                async generatePdf() {
                    const btn = document.getElementById('generate-report-pdf-btn');
                    btn.disabled = true; btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> A gerar...`;
                    const filters = {
                        plano_interno: document.getElementById('report-filter-pi').value || undefined,
                        nd: document.getElementById('report-filter-nd').value || undefined,
                        secao_responsavel_id: document.getElementById('report-filter-secao').value || undefined,
                        status: document.getElementById('report-filter-status').value || undefined,
                        incluir_detalhes: document.getElementById('report-incluir-detalhes').checked,
                    };
                    Object.keys(filters).forEach(key => filters[key] === undefined && delete filters[key]);
                    const params = new URLSearchParams(filters).toString();
                    try {
                        const blob = await apiService.download(`/relatorios/pdf?${params}`);
                        eventHandlers.handleFileDownload(blob, 'relatorio_salc.pdf');
                    } catch (error) {
                        uiComponents.openModal('Erro ao Gerar Relatório', `<p>${error.message}</p>`);
                    } finally {
                        btn.disabled = false; btn.innerHTML = `<i class="fas fa-file-pdf"></i> Gerar PDF`;
                    }
                },

                async generateExcel() {
                    const btn = document.getElementById('generate-report-excel-btn');
                    btn.disabled = true; btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> A exportar...`;
                    const filters = {
                        plano_interno: document.getElementById('report-filter-pi').value || undefined,
                        nd: document.getElementById('report-filter-nd').value || undefined,
                        secao_responsavel_id: document.getElementById('report-filter-secao').value || undefined,
                        status: document.getElementById('report-filter-status').value || undefined,
                        incluir_detalhes: document.getElementById('report-incluir-detalhes').checked,
                    };
                    Object.keys(filters).forEach(key => filters[key] === undefined && delete filters[key]);
                    const params = new URLSearchParams(filters).toString();
                    try {
                        const blob = await apiService.download(`/relatorios/excel/geral?${params}`);
                        eventHandlers.handleFileDownload(blob, 'relatorio_geral_salc.xlsx');
                    } catch (error)
                    {
                        uiComponents.openModal('Erro ao Exportar Relatório', `<p>${error.message}</p>`);
                    } finally {
                        btn.disabled = false; btn.innerHTML = `<i class="fas fa-file-excel"></i> Exportar para Excel`;
                    }
                },

                async exportToExcel(type) {
                    const btn = document.getElementById(type === 'notas-credito' ? 'export-nc-btn' : 'export-empenho-btn');
                    const originalHtml = btn.innerHTML;
                    btn.disabled = true; btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Exportando...`;
                    
                    let params = new URLSearchParams();
                    if (type === 'notas-credito') {
                        const cleanFilters = Object.fromEntries(Object.entries(appState.currentFilters.nc).filter(([_, v]) => v != ''));
                        params = new URLSearchParams(cleanFilters);
                    }
                    
                    try {
                        const blob = await apiService.download(`/relatorios/excel/${type}?${params.toString()}`);
                        eventHandlers.handleFileDownload(blob, `relatorio_${type}.xlsx`);
                    } catch (error) {
                        uiComponents.openModal('Erro ao Exportar', `<p>${error.message}</p>`);
                    } finally {
                        btn.disabled = false; btn.innerHTML = originalHtml;
                    }
                }
            },
            
            handleFileDownload(blob, filename) {
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none'; a.href = url; a.download = filename;
                document.body.appendChild(a); a.click();
                window.URL.revokeObjectURL(url); a.remove();
            }
        };

        // ========================================================================
        // 6. MÓDULO PRINCIPAL DA APLICAÇÃO (app)
        // ========================================================================

        const app = {
            async init() {
                if (!localStorage.getItem('accessToken')) {
                    window.location.href = 'login.html';
                    return;
                }
                try {
                    currentUser = await apiService.get('/users/me');
                    this.renderLayout();
                    this.navigateTo('dashboard');
                    DOM.appMain.addEventListener('click', eventHandlers.handleMainClick.bind(eventHandlers));
                } catch (error) {
                    console.error("Falha na inicialização ou token inválido:", error);
                    this.logout();
                }
            },

            logout() {
                localStorage.removeItem('accessToken');
                window.location.href = 'login.html';
            },

            renderLayout() {
                DOM.usernameDisplay.textContent = `Utilizador: ${currentUser.username} (${currentUser.role})`;
                DOM.logoutBtn.addEventListener('click', this.logout);
                let navHTML = `<button class="tab-btn active" data-view="dashboard">Dashboard</button><button class="tab-btn" data-view="notasCredito">Notas de Crédito</button><button class="tab-btn" data-view="empenhos">Empenhos</button>`;
                if (currentUser.role === 'ADMINISTRADOR') {
                    navHTML += `<button class="tab-btn" data-view="admin">Administração</button>`;
                }
                DOM.appNav.innerHTML = navHTML;
                DOM.appNav.addEventListener('click', (e) => {
                    if (e.target.matches('.tab-btn')) {
                        DOM.appNav.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                        e.target.classList.add('active');
                        this.navigateTo(e.target.dataset.view);
                    }
                });
            },

            async navigateTo(view, params = {}) {
                uiComponents.showLoading(DOM.appMain);
                try {
                    switch (view) {
                        case 'dashboard': await viewRenderer.dashboard(DOM.appMain); break;
                        case 'notasCredito': await viewRenderer.notasCredito(DOM.appMain, params.page || 1); break;
                        case 'empenhos': await viewRenderer.empenhos(DOM.appMain, params.page || 1); break;
                        case 'admin': await viewRenderer.admin(DOM.appMain); break;
                        default: throw new Error("Página não encontrada");
                    }
                } catch (error) {
                    uiComponents.showError(DOM.appMain, error);
                }
            },
        };

        // ========================================================================
        // 7. INICIALIZAÇÃO DA APLICAÇÃO
        // ========================================================================
        
        app.init();
    });
})(); // Fim do IIFE
