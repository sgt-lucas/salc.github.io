// main.js
document.addEventListener('DOMContentLoaded', () => {
    // Configuração inicial e estado da aplicação
    const API_URL = 'https://salc.onrender.com';
    const accessToken = localStorage.getItem('accessToken');
    let currentUser = null;
    let appState = {
        secoes: [],
        notasCredito: [],
        empenhos: [],
        users: [],
        auditLogs: [],
    };

    const appNav = document.getElementById('app-nav');
    const appMain = document.getElementById('app-main');
    const usernameDisplay = document.getElementById('username-display');
    const logoutBtn = document.getElementById('logout-btn');
    const modalContainer = document.getElementById('modal-container');
    const modalTemplate = document.getElementById('modal-template');

    // Função auxiliar para requisições à API
    async function fetchWithAuth(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            ...options.headers,
        };

        const response = await fetch(`${API_URL}${endpoint}`, { ...options, headers });

        if (response.status === 401) {
            logout();
            throw new Error('Sessão expirada. Por favor, faça login novamente.');
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Ocorreu um erro na requisição.');
        }

        return response.status === 204 ? null : response.json();
    }

    // Inicialização e autenticação
    async function initApp() {
        if (!accessToken) {
            window.location.href = 'login.html';
            return;
        }
        try {
            currentUser = await fetchWithAuth('/users/me');
            renderLayout();
            await navigateTo('dashboard');
        } catch (error) {
            console.error('Falha na autenticação ou inicialização:', error);
            logout();
        }
    }

    function logout() {
        localStorage.removeItem('accessToken');
        window.location.href = 'login.html';
    }

    // Renderização do layout e navegação
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

    async function navigateTo(view) {
        appMain.innerHTML = `<div class="loading-spinner"><p>Carregando...</p></div>`;
        switch (view) {
            case 'dashboard':
                await renderDashboardView(appMain);
                break;
            case 'notasCredito':
                await renderNotasCreditoView(appMain);
                break;
            case 'empenhos':
                await renderEmpenhosView(appMain);
                break;
            case 'admin':
                await renderAdminView(appMain);
                break;
            default:
                appMain.innerHTML = `<h1>Página não encontrada</h1>`;
        }
    }

    // Lógica das views
    async function renderDashboardView(container) {
        try {
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
                } else if (diffDays < 0) {
                    avisoTexto = `Venceu há ${Math.abs(diffDays)} dias (${prazo.toLocaleDateString('pt-BR')})!`;
                } else {
                    avisoTexto = `Vence hoje (${prazo.toLocaleDateString('pt-BR')})!`;
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

            if (typeof Chart === 'undefined') {
                console.error('Chart.js não carregado');
                return;
            }
            renderChart('grafico-secoes', graficoSecoesData.labels, graficoSecoesData.data);
        } catch (error) {
            container.innerHTML = `<div class="error-message">Não foi possível carregar os dados do dashboard: ${error.message}</div>`;
        }
    }

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
                                if (label) label += ': ';
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

    async function populateFilters() {
        try {
            if (appState.secoes.length === 0) {
                appState.secoes = await fetchWithAuth('/secoes');
            }
            const notasCredito = await fetchWithAuth('/notas-credito');

            const piSelect = document.getElementById('filter-pi');
            const ndSelect = document.getElementById('filter-nd');
            const secaoSelect = document.getElementById('filter-secao');

            secaoSelect.innerHTML = '<option value="">Todas</option>' + appState.secoes.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');

            const planosInternos = [...new Set(notasCredito.map(nc => nc.plano_interno))];
            const naturezasDespesa = [...new Set(notasCredito.map(nc => nc.nd))];

            piSelect.innerHTML = '<option value="">Todos</option>' + planosInternos.sort().map(pi => `<option value="${pi}">${pi}</option>`).join('');
            ndSelect.innerHTML = '<option value="">Todas</option>' + naturezasDespesa.sort().map(nd => `<option value="${nd}">${nd}</option>`).join('');
        } catch (error) {
            console.error("Erro ao popular filtros:", error);
        }
    }

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
                tableBody.innerHTML = `<tr><td colspan="9" style="text-align:center;">Nenhuma Nota de Crédito encontrada.</td></tr>`;
                return;
            }

            tableBody.innerHTML = notas.map(nc => `
                <tr data-id="${nc.id}">
                    <td>${nc.numero_nc}</td>
                    <td>${nc.plano_interno}</td>
                    <td>${nc.nd}</td>
                    <td>${nc.secao_responsavel.nome}</td>
                    <td>${nc.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>${nc.saldo_disponivel.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>${new Date(nc.prazo_empenho + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td><span class="status status-${nc.status.toLowerCase().replace(/ /g, '-')}">${nc.status}</span></td>
                    <td class="actions">
                        <button class="btn-icon" data-action="extrato-nc" title="Ver Extrato"><i class="fas fa-file-alt"></i></button>
                        <button class="btn-icon" data-action="edit-nc" title="Editar NC"><i class="fas fa-edit"></i></button>
                        ${currentUser.role === 'ADMINISTRADOR' ? 
                            `<button class="btn-icon btn-delete" data-action="delete-nc" data-numero="${nc.numero_nc}" title="Excluir NC"><i class="fas fa-trash"></i></button>` : ''}
                    </td>
                </tr>
            `).join('');
        } catch (error) {
            tableBody.innerHTML = `<tr><td colspan="9" class="error-message">Erro ao carregar dados: ${error.message}</td></tr>`;
        }
    }

    async function renderEmpenhosView(container) {
        container.innerHTML = `
            <div class="view-header">
                <h1>Gestão de Empenhos</h1>
                <button id="add-empenho-btn" class="btn btn-primary"><i class="fas fa-plus"></i> Adicionar Novo Empenho</button>
            </div>
            <div class="table-container card">
                <table id="empenhos-table">
                    <thead>
                        <tr>
                            <th>Nº do Empenho</th>
                            <th>Nº da NC Associada</th>
                            <th>Seção</th>
                            <th>Valor</th>
                            <th>Data</th>
                            <th>Observação</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr><td colspan="7" style="text-align:center;">Carregando dados...</td></tr>
                    </tbody>
                </table>
            </div>
        `;
        await loadAndRenderEmpenhosTable();
    }

    async function loadAndRenderEmpenhosTable() {
        const tableBody = document.querySelector('#empenhos-table tbody');
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;">Buscando dados...</td></tr>`;
        try {
            const [empenhos, notas, secoes] = await Promise.all([
                fetchWithAuth(`/empenhos`),
                fetchWithAuth('/notas-credito'),
                fetchWithAuth('/secoes')
            ]);

            appState.empenhos = empenhos;
            const ncMap = new Map(notas.map(nc => [nc.id, nc.numero_nc]));
            const secoesMap = new Map(secoes.map(s => [s.id, s.nome]));

            if (empenhos.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;">Nenhum empenho encontrado.</td></tr>`;
                return;
            }

            tableBody.innerHTML = empenhos.map(e => `
                <tr data-id="${e.id}">
                    <td>${e.numero_ne}</td>
                    <td>${ncMap.get(e.nota_credito_id) || 'N/A'}</td>
                    <td>${secoesMap.get(e.secao_requisitante_id) || 'N/A'}</td>
                    <td>${e.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>${new Date(e.data_empenho + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td>${e.observacao || ''}</td>
                    <td class="actions">
                        <button class="btn-icon" data-action="edit-empenho" title="Editar Empenho"><i class="fas fa-edit"></i></button>
                        ${currentUser.role === 'ADMINISTRADOR' ? 
                            `<button class="btn-icon btn-delete" data-action="delete-empenho" data-numero="${e.numero_ne}" title="Excluir Empenho"><i class="fas fa-trash"></i></button>` : ''}
                    </td>
                </tr>
            `).join('');
        } catch (error) {
            tableBody.innerHTML = `<tr><td colspan="7" class="error-message">Erro ao carregar empenhos: ${error.message}</td></tr>`;
        }
    }

    async function renderAdminView(container, subView = 'secoes') {
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
            <div id="admin-content" class="card"></div>
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
        await renderAdminSubView(adminContent, subView);
    }

    async function renderAdminSubView(container, subView) {
        container.innerHTML = `<div class="loading-spinner"><p>Carregando...</p></div>`;
        switch (subView) {
            case 'users': await renderAdminUsersView(container); break;
            case 'secoes': await renderAdminSeçõesView(container); break;
            case 'logs': await renderAdminLogsView(container); break;
            default: container.innerHTML = 'Selecione uma opção.';
        }
    }

    async function renderAdminSeçõesView(container) {
        container.innerHTML = `
            <h3>Gerenciar Seções</h3>
            <p>Adicione, renomeie ou exclua seções da lista utilizada nos formulários.</p>
            <form id="secao-form" class="admin-form">
                <input type="hidden" name="id" value="">
                <input type="text" name="nome" placeholder="Nome da seção" required>
                <button type="submit" class="btn btn-primary">Adicionar Seção</button>
                <button type="button" class="btn" id="cancel-secao-btn">Cancelar</button>
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
        container.querySelector('#cancel-secao-btn').addEventListener('click', () => {
            const form = document.getElementById('secao-form');
            form.reset();
            form.querySelector('input[name="id"]').value = '';
            form.querySelector('button[type="submit"]').textContent = 'Adicionar Seção';
        });
    }

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

    async function loadAndRenderSeçõesTable() {
        const tableBody = document.querySelector('#secoes-table tbody');
        try {
            const secoes = await fetchWithAuth('/secoes');
            appState.secoes = secoes;
            tableBody.innerHTML = secoes.length === 0 ? '<tr><td colspan="3">Nenhuma seção cadastrada.</td></tr>' :
                secoes.map(s => `
                    <tr data-id="${s.id}">
                        <td>${s.id}</td>
                        <td>${s.nome}</td>
                        <td class="actions">
                            <button class="btn-icon" data-action="edit-secao" data-nome="${s.nome}" title="Editar"><i class="fas fa-edit"></i></button>
                            <button class="btn-icon btn-delete" data-action="delete-secao" data-nome="${s.nome}" title="Excluir"><i class="fas fa-trash"></i></button>
                        </td>
                    </tr>
                `).join('');
        } catch (error) {
            tableBody.innerHTML = `<tr><td colspan="3" class="error-message">Erro ao carregar seções: ${error.message}</td></tr>`;
        }
    }

    async function handleSecaoFormSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const id = form.id.value;
        const nome = form.nome.value.trim();
        const method = id ? 'PUT' : 'POST';
        const endpoint = id ? `/secoes/${id}` : '/secoes';

        try {
            await fetchWithAuth(endpoint, { method, body: JSON.stringify({ nome }) });
            form.reset();
            form.querySelector('input[name="id"]').value = '';
            form.querySelector('button[type="submit"]').textContent = 'Adicionar Seção';
            await loadAndRenderSeçõesTable();
            appState.secoes = await fetchWithAuth('/secoes');
        } catch (error) {
            alert(`Erro ao salvar seção: ${error.message}`);
        }
    }

    async function loadAndRenderUsersTable() {
        const tableBody = document.querySelector('#users-table tbody');
        try {
            const users = await fetchWithAuth('/users');
            appState.users = users;
            tableBody.innerHTML = users.length === 0 ? '<tr><td colspan="5">Nenhum usuário cadastrado.</td></tr>' :
                users.map(u => `
                    <tr data-id="${u.id}">
                        <td>${u.id}</td>
                        <td>${u.username}</td>
                        <td>${u.email}</td>
                        <td>${u.role}</td>
                        <td class="actions">
                            ${u.id === currentUser.id ? '<span>(Você)</span>' : 
                            `<button class="btn-icon btn-delete" data-action="delete-user" data-username="${u.username}" title="Excluir"><i class="fas fa-trash"></i></button>`}
                        </td>
                    </tr>
                `).join('');
        } catch (error) {
            tableBody.innerHTML = `<tr><td colspan="5" class="error-message">Erro ao carregar usuários: ${error.message}</td></tr>`;
        }
    }

    async function handleUserFormSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const data = Object.fromEntries(new FormData(form).entries());

        try {
            await fetchWithAuth('/users', { method: 'POST', body: JSON.stringify(data) });
            form.reset();
            await loadAndRenderUsersTable();
            appState.users = await fetchWithAuth('/users');
        } catch (error) {
            alert(`Erro ao criar usuário: ${error.message}`);
        }
    }

    async function renderAdminLogsView(container) {
        container.innerHTML = `
            <h3>Log de Auditoria</h3>
            <p>Registro de todas as ações importantes realizadas no sistema.</p>
            <div class="table-container" style="margin-top: 1.5rem;">
                <table id="logs-table">
                    <thead><tr><th>Data/Hora (Local)</th><th>Usuário</th><th>Ação</th><th>Detalhes</th></tr></thead>
                    <tbody></tbody>
                </table>
            </div>
            <div class="pagination">
                <button id="prev-page-btn" class="btn">Anterior</button>
                <span id="page-info">Página 1</span>
                <button id="next-page-btn" class="btn">Próxima</button>
            </div>
        `;

        let currentPage = 0;
        const pageSize = 50;

        const loadPage = (page) => {
            loadAndRenderAuditLogsTable(page, pageSize);
        };

        document.getElementById('prev-page-btn').addEventListener('click', () => {
            if (currentPage > 0) {
                currentPage--;
                loadPage(currentPage);
            }
        });

        document.getElementById('next-page-btn').addEventListener('click', () => {
            currentPage++;
            loadPage(currentPage);
        });

        loadPage(currentPage);
    }

    async function loadAndRenderAuditLogsTable(page = 0, limit = 50) {
        const tableBody = document.querySelector('#logs-table tbody');
        const pageInfo = document.getElementById('page-info');
        const prevBtn = document.getElementById('prev-page-btn');
        const nextBtn = document.getElementById('next-page-btn');

        tableBody.innerHTML = '<tr><td colspan="4">Carregando logs...</td></tr>';
        pageInfo.textContent = `Página ${page + 1}`;
        prevBtn.disabled = page === 0;

        try {
            const skip = page * limit;
            const logs = await fetchWithAuth(`/audit-logs?skip=${skip}&limit=${limit}`);
            
            nextBtn.disabled = logs.length < limit;

            if (logs.length === 0 && page === 0) {
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

    function openModal(title, contentHTML, onOpen) {
        const modalClone = modalTemplate.content.cloneNode(true);
        const modalElement = modalClone.querySelector('.modal');
        
        modalClone.querySelector('.modal-title').textContent = title;
        modalClone.querySelector('.modal-body').innerHTML = contentHTML;
        
        modalContainer.innerHTML = '';
        modalContainer.appendChild(modalClone);
        
        const newModal = modalContainer.querySelector('.modal-backdrop');
        newModal.addEventListener('click', (e) => { if (e.target === newModal) closeModal(); });
        newModal.querySelector('.modal-close-btn').addEventListener('click', closeModal);
        document.addEventListener('keydown', handleEscapeKey);

        if (onOpen) onOpen(modalElement);
    }

    function closeModal() {
        modalContainer.innerHTML = '';
        document.removeEventListener('keydown', handleEscapeKey);
    }

    function handleEscapeKey(e) {
        if (e.key === 'Escape') closeModal();
    }

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
                    <button type="button" class="btn" onclick="document.dispatchEvent(new Event('closeModal'))">Cancelar</button>
                </div>
            </form>
        `;
    }

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

        if (data.data_chegada && data.prazo_empenho && new Date(data.prazo_empenho) < new Date(data.data_chegada)) {
            alert('Erro: O prazo para empenho não pode ser anterior à data de chegada.');
            submitButton.disabled = false;
            return;
        }

        try {
            await fetchWithAuth(endpoint, { method, body: JSON.stringify(data) });
            closeModal();
            const currentFilters = getCurrentFilters();
            await loadAndRenderNotasTable(currentFilters);
            appState.notasCredito = await fetchWithAuth('/notas-credito');
        } catch (error) {
            alert(`Erro ao salvar: ${error.message}`);
            submitButton.disabled = false;
        }
    }

    function getCurrentFilters() {
        const view = document.querySelector('.tab-btn.active')?.dataset.view;
        if (view === 'notasCredito') {
            return {
                plano_interno: document.getElementById('filter-pi')?.value,
                nd: document.getElementById('filter-nd')?.value,
                secao_responsavel_id: document.getElementById('filter-secao')?.value,
                status: document.getElementById('filter-status')?.value,
            };
        }
        return {};
    }

    function getEmpenhoFormHTML(empenho = {}) {
        const isEditing = !!empenho.id;
        const notasOptions = appState.notasCredito.map(nc => 
            `<option value="${nc.id}" ${nc.id === empenho.nota_credito_id ? 'selected' : ''}>${nc.numero_nc}</option>`
        ).join('');
        const secoesOptions = appState.secoes.map(s => 
            `<option value="${s.id}" ${s.id === empenho.secao_requisitante_id ? 'selected' : ''}>${s.nome}</option>`
        ).join('');

        return `
            <form id="empenho-form" data-id="${isEditing ? empenho.id : ''}">
                <div class="form-grid">
                    <div class="form-field"><label for="numero_ne">Número do Empenho</label><input type="text" name="numero_ne" value="${empenho.numero_ne || ''}" required></div>
                    <div class="form-field"><label for="valor">Valor (R$)</label><input type="number" name="valor" step="0.01" value="${empenho.valor || ''}" required></div>
                    <div class="form-field"><label for="nota_credito_id">Nota de Crédito</label><select name="nota_credito_id" required>${notasOptions}</select></div>
                    <div class="form-field"><label for="secao_requisitante_id">Seção Requisitante</label><select name="secao_requisitante_id" required>${secoesOptions}</select></div>
                    <div class="form-field"><label for="data_empenho">Data de Empenho</label><input type="date" name="data_empenho" value="${empenho.data_empenho || ''}" required></div>
                    <div class="form-field form-field-full"><label for="observacao">Observação</label><textarea name="observacao">${empenho.observacao || ''}</textarea></div>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">${isEditing ? 'Salvar Alterações' : 'Criar Empenho'}</button>
                    <button type="button" class="btn" onclick="document.dispatchEvent(new Event('closeModal'))">Cancelar</button>
                </div>
            </form>
        `;
    }

    async function handleEmpenhoFormSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const id = form.dataset.id;
        const method = id ? 'PUT' : 'POST';
        const endpoint = id ? `/empenhos/${id}` : '/empenhos';

        const submitButton = form.querySelector('button[type="submit"]');
        submitButton.disabled = true;

        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());
        data.valor = parseFloat(data.valor);
        data.nota_credito_id = parseInt(data.nota_credito_id);
        data.secao_requisitante_id = parseInt(data.secao_requisitante_id);

        try {
            await fetchWithAuth(endpoint, { method, body: JSON.stringify(data) });
            closeModal();
            await loadAndRenderEmpenhosTable();
            appState.empenhos = await fetchWithAuth('/empenhos');
        } catch (error) {
            alert(`Erro ao salvar empenho: ${error.message}`);
            submitButton.disabled = false;
        }
    }

    async function renderExtratoNc(id) {
        try {
            const nc = await fetchWithAuth(`/notas-credito/${id}`);
            const empenhos = await fetchWithAuth(`/empenhos?nota_credito_id=${id}`);
            const recolhimentos = await fetchWithAuth(`/recolhimentos-saldo?nota_credito_id=${id}`);

            const empenhosHTML = empenhos.length > 0 ? empenhos.map(e => `
                <tr>
                    <td>${e.numero_ne}</td>
                    <td>${e.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>${new Date(e.data_empenho + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td>${e.observacao || ''}</td>
                </tr>
            `).join('') : '<tr><td colspan="4">Nenhum empenho associado.</td></tr>';

            const recolhimentosHTML = recolhimentos.length > 0 ? recolhimentos.map(r => `
                <tr>
                    <td>${r.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>${new Date(r.data + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td>${r.observacao || ''}</td>
                </tr>
            `).join('') : '<tr><td colspan="3">Nenhum recolhimento registrado.</td></tr>';

            const contentHTML = `
                <h3>Detalhes da NC ${nc.numero_nc}</h3>
                <p><strong>Plano Interno:</strong> ${nc.plano_interno}</p>
                <p><strong>Natureza de Despesa:</strong> ${nc.nd}</p>
                <p><strong>Seção:</strong> ${nc.secao_responsavel.nome}</p>
                <p><strong>Valor Original:</strong> ${nc.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                <p><strong>Saldo Disponível:</strong> ${nc.saldo_disponivel.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                <p><strong>Prazo:</strong> ${new Date(nc.prazo_empenho + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
                <p><strong>Status:</strong> ${nc.status}</p>
                <h4>Empenhos Associados</h4>
                <table>
                    <thead>
                        <tr><th>Nº do Empenho</th><th>Valor</th><th>Data</th><th>Observação</th></tr>
                    </thead>
                    <tbody>${empenhosHTML}</tbody>
                </table>
                <h4>Recolhimentos de Saldo</h4>
                <table>
                    <thead>
                        <tr><th>Valor</th><th>Data</th><th>Observação</th></tr>
                    </thead>
                    <tbody>${recolhimentosHTML}</tbody>
                </table>
            `;

            openModal(`Extrato da Nota de Crédito ${nc.numero_nc}`, contentHTML);
        } catch (error) {
            alert(`Erro ao carregar extrato: ${error.message}`);
        }
    }

    // Manipulador de eventos globais
    appMain.addEventListener('click', async (e) => {
        const target = e.target.closest('button');
        if (!target) return;

        const action = target.dataset.action;
        const id = target.closest('tr')?.dataset.id;

        if (target.id === 'add-nc-btn') {
            const formHTML = getNotaCreditoFormHTML();
            openModal('Adicionar Nova Nota de Crédito', formHTML, (modalElement) => {
                modalElement.querySelector('#nc-form').addEventListener('submit', handleNcFormSubmit);
            });
        }

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

        if (action === 'delete-nc') {
            const numeroNc = target.dataset.numero;
            if (confirm(`Tem certeza que deseja excluir a Nota de Crédito "${numeroNc}"?\n\nEsta ação não pode ser desfeita.`)) {
                try {
                    await fetchWithAuth(`/notas-credito/${id}`, { method: 'DELETE' });
                    const currentFilters = getCurrentFilters();
                    await loadAndRenderNotasTable(currentFilters);
                    appState.notasCredito = await fetchWithAuth('/notas-credito');
                } catch (error) {
                    alert(`Erro ao excluir NC: ${error.message}`);
                }
            }
        }

        if (action === 'extrato-nc') {
            await renderExtratoNc(id);
        }

        if (target.id === 'add-empenho-btn') {
            const formHTML = getEmpenhoFormHTML();
            openModal('Adicionar Novo Empenho', formHTML, (modalElement) => {
                modalElement.querySelector('#empenho-form').addEventListener('submit', handleEmpenhoFormSubmit);
            });
        }

        if (action === 'edit-empenho') {
            try {
                const empenhoData = await fetchWithAuth(`/empenhos/${id}`);
                const formHTML = getEmpenhoFormHTML(empenhoData);
                openModal(`Editar Empenho: ${empenhoData.numero_ne}`, formHTML, (modalElement) => {
                    modalElement.querySelector('#empenho-form').addEventListener('submit', handleEmpenhoFormSubmit);
                });
            } catch (error) {
                alert(`Erro ao buscar dados do empenho: ${error.message}`);
            }
        }

        if (action === 'delete-empenho') {
            const numeroNe = target.dataset.numero;
            if (confirm(`Tem certeza que deseja excluir o Empenho "${numeroNe}"?`)) {
                try {
                    await fetchWithAuth(`/empenhos/${id}`, { method: 'DELETE' });
                    await loadAndRenderEmpenhosTable();
                    appState.empenhos = await fetchWithAuth('/empenhos');
                } catch (error) {
                    alert(`Erro ao excluir empenho: ${error.message}`);
                }
            }
        }

        if (action === 'edit-secao') {
            const nome = target.dataset.nome;
            const form = document.getElementById('secao-form');
            form.id.value = id;
            form.nome.value = nome;
            form.querySelector('button[type="submit"]').textContent = 'Salvar Alterações';
        }

        if (action === 'delete-secao') {
            const nome = target.dataset.nome;
            if (confirm(`Tem certeza que deseja excluir a seção "${nome}"?`)) {
                try {
                    await fetchWithAuth(`/secoes/${id}`, { method: 'DELETE' });
                    await loadAndRenderSeçõesTable();
                    appState.secoes = await fetchWithAuth('/secoes');
                } catch (error) {
                    alert(`Erro ao excluir seção: ${error.message}`);
                }
            }
        }

        if (action === 'delete-user') {
            const username = target.dataset.username;
            if (confirm(`Tem certeza que deseja excluir o usuário "${username}"?`)) {
                try {
                    await fetchWithAuth(`/users/${id}`, { method: 'DELETE' });
                    await loadAndRenderUsersTable();
                    appState.users = await fetchWithAuth('/users');
                } catch (error) {
                    alert(`Erro ao excluir usuário: ${error.message}`);
                }
            }
        }
    });

    document.addEventListener('closeModal', closeModal);

    initApp();
});
