import os
import io
import enum
import re
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, status, Query, Response, Cookie
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field, validator
from sqlalchemy import create_engine, Column, Integer, String, Float, Date, ForeignKey, DateTime, Enum as SQLAlchemyEnum, desc
from sqlalchemy.orm import sessionmaker, Session, relationship, DeclarativeBase
from sqlalchemy.exc import IntegrityError
from sqlalchemy.sql import func
from dotenv import load_dotenv

# --- Segurança e Autenticação ---
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi.security import OAuth2PasswordRequestForm

# --- PDF Reporting ---
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch

# Carregar variáveis de ambiente do ficheiro .env (para desenvolvimento local)
load_dotenv()

# ==============================================================================
# 1. CONFIGURAÇÃO INICIAL E DE SEGURANÇA
# ==============================================================================

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 120
FRONTEND_URL = os.getenv("FRONTEND_URL")
# **NOVA VARIÁVEL** para o domínio do backend
BACKEND_URL = "salc.onrender.com"

if not SECRET_KEY:
    raise RuntimeError("FATAL: A variável de ambiente SECRET_KEY não está configurada.")
if not FRONTEND_URL:
    raise RuntimeError("FATAL: A variável de ambiente FRONTEND_URL não está configurada.")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ==============================================================================
# 2. CONFIGURAÇÃO DO BANCO DE DADOS
# ==============================================================================

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("FATAL: A variável de ambiente DATABASE_URL não está configurada.")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass

# ==============================================================================
# 3. MODELOS DO BANCO DE DADOS (SQLAlchemy)
# ==============================================================================

class UserRole(str, enum.Enum):
    OPERADOR = "OPERADOR"
    ADMINISTRADOR = "ADMINISTRADOR"

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(SQLAlchemyEnum(UserRole), nullable=False, default=UserRole.OPERADOR)

class Seção(Base):
    __tablename__ = "secoes"
    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String, unique=True, nullable=False)
    notas_credito = relationship("NotaCredito", back_populates="secao_responsavel")
    empenhos = relationship("Empenho", back_populates="secao_requisitante")

class NotaCredito(Base):
    __tablename__ = "notas_credito"
    id = Column(Integer, primary_key=True, index=True)
    numero_nc = Column(String, unique=True, nullable=False, index=True)
    valor = Column(Float, nullable=False)
    esfera = Column(String)
    fonte = Column(String(10))
    ptres = Column(String(6))
    plano_interno = Column(String, index=True)
    nd = Column(String(6), index=True)
    data_chegada = Column(Date)
    prazo_empenho = Column(Date)
    descricao = Column(String, nullable=True)
    secao_responsavel_id = Column(Integer, ForeignKey("secoes.id", ondelete="RESTRICT"), index=True)
    saldo_disponivel = Column(Float, nullable=False)
    status = Column(String, default="Ativa", index=True)

    secao_responsavel = relationship("Seção", back_populates="notas_credito")
    empenhos = relationship("Empenho", back_populates="nota_credito", cascade="all, delete-orphan", passive_deletes=True)
    recolhimentos = relationship("RecolhimentoSaldo", back_populates="nota_credito", cascade="all, delete-orphan", passive_deletes=True)

class Empenho(Base):
    __tablename__ = "empenhos"
    id = Column(Integer, primary_key=True, index=True)
    numero_ne = Column(String, unique=True, nullable=False, index=True)
    valor = Column(Float, nullable=False)
    data_empenho = Column(Date)
    observacao = Column(String, nullable=True)
    nota_credito_id = Column(Integer, ForeignKey("notas_credito.id", ondelete="CASCADE"))
    secao_requisitante_id = Column(Integer, ForeignKey("secoes.id", ondelete="RESTRICT"))

    nota_credito = relationship("NotaCredito", back_populates="empenhos")
    secao_requisitante = relationship("Seção", back_populates="empenhos")
    anulacoes = relationship("AnulacaoEmpenho", back_populates="empenho", cascade="all, delete-orphan", passive_deletes=True)

class AnulacaoEmpenho(Base):
    __tablename__ = "anulacoes_empenho"
    id = Column(Integer, primary_key=True, index=True)
    empenho_id = Column(Integer, ForeignKey("empenhos.id", ondelete="CASCADE"))
    valor = Column(Float, nullable=False)
    data = Column(Date, nullable=False)
    observacao = Column(String, nullable=True)

    empenho = relationship("Empenho", back_populates="anulacoes")

class RecolhimentoSaldo(Base):
    __tablename__ = "recolhimentos_saldo"
    id = Column(Integer, primary_key=True, index=True)
    nota_credito_id = Column(Integer, ForeignKey("notas_credito.id", ondelete="CASCADE"))
    valor = Column(Float, nullable=False)
    data = Column(Date, nullable=False)
    observacao = Column(String, nullable=True)

    nota_credito = relationship("NotaCredito", back_populates="recolhimentos")

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    username = Column(String, nullable=False)
    action = Column(String, nullable=False)
    details = Column(String, nullable=True)

# ==============================================================================
# 4. SCHEMAS DE DADOS (Pydantic)
# ==============================================================================

class UserBase(BaseModel):
    username: str
    email: EmailStr

class UserCreate(UserBase):
    password: str
    role: UserRole

    @validator('password')
    def validate_password_strength(cls, v):
        if len(v) < 8:
            raise ValueError('A senha deve ter pelo menos 8 caracteres.')
        if not re.search("[a-z]", v):
            raise ValueError('A senha deve conter pelo menos uma letra minúscula.')
        if not re.search("[A-Z]", v):
            raise ValueError('A senha deve conter pelo menos uma letra maiúscula.')
        if not re.search("[0-9]", v):
            raise ValueError('A senha deve conter pelo menos um número.')
        return v

class UserInDB(UserBase):
    id: int
    role: UserRole
    class Config:
        from_attributes = True

class SeçãoBase(BaseModel):
    nome: str

class SeçãoCreate(SeçãoBase):
    pass

class SeçãoInDB(SeçãoBase):
    id: int
    nome: str
    class Config:
        from_attributes = True

class NotaCreditoBase(BaseModel):
    numero_nc: str
    valor: float = Field(..., gt=0)
    esfera: str
    fonte: str = Field(..., max_length=10)
    ptres: str = Field(..., max_length=6)
    plano_interno: str
    nd: str = Field(..., max_length=6, pattern=r'^\d{6}$')
    data_chegada: date
    prazo_empenho: date
    descricao: Optional[str] = None
    secao_responsavel_id: int

class NotaCreditoCreate(NotaCreditoBase):
    pass

class NotaCreditoInDB(NotaCreditoBase):
    id: int
    saldo_disponivel: float
    status: str
    secao_responsavel: SeçãoInDB
    class Config:
        from_attributes = True

class EmpenhoBase(BaseModel):
    numero_ne: str
    valor: float = Field(..., gt=0)
    data_empenho: date
    observacao: Optional[str] = None
    nota_credito_id: int
    secao_requisitante_id: int

class EmpenhoCreate(EmpenhoBase):
    pass

class EmpenhoInDB(EmpenhoBase):
    id: int
    secao_requisitante: SeçãoInDB
    nota_credito: NotaCreditoInDB 
    class Config:
        from_attributes = True

class AnulacaoEmpenhoBase(BaseModel):
    empenho_id: int
    valor: float = Field(..., gt=0)
    data: date
    observacao: Optional[str] = None

class AnulacaoEmpenhoInDB(AnulacaoEmpenhoBase):
    id: int
    class Config:
        from_attributes = True

class RecolhimentoSaldoBase(BaseModel):
    nota_credito_id: int
    valor: float = Field(..., gt=0)
    data: date
    observacao: Optional[str] = None

class RecolhimentoSaldoInDB(RecolhimentoSaldoBase):
    id: int
    class Config:
        from_attributes = True

class AuditLogInDB(BaseModel):
    id: int
    timestamp: datetime
    username: str
    action: str
    details: Optional[str] = None
    class Config:
        from_attributes = True

class PaginatedNCS(BaseModel):
    total: int
    page: int
    size: int
    results: List[NotaCreditoInDB]

class PaginatedEmpenhos(BaseModel):
    total: int
    page: int
    size: int
    results: List[EmpenhoInDB]

# ==============================================================================
# 5. APLICAÇÃO FastAPI E EVENTO DE STARTUP
# ==============================================================================

app = FastAPI(title="Sistema de Gestão de Notas de Crédito", version="2.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    print("Iniciando aplicação e criando tabelas da base de dados, se necessário...")
    Base.metadata.create_all(bind=engine)
    print("Aplicação iniciada com sucesso.")


# ==============================================================================
# 6. UTILITÁRIOS E DEPENDÊNCIAS
# ==============================================================================

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def log_audit_action(db: Session, username: str, action: str, details: str = None):
    log = AuditLog(username=username, action=action, details=details)
    db.add(log)
    db.commit()

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(access_token: Optional[str] = Cookie(None), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciais inválidas. Por favor, faça login novamente.",
    )
    if access_token is None:
        raise credentials_exception
    try:
        payload = jwt.decode(access_token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    return user

async def get_current_admin_user(current_user: User = Depends(get_current_user)):
    if current_user.role != UserRole.ADMINISTRADOR:
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores")
    return current_user

# ==============================================================================
# 7. ENDPOINTS DA API
# ==============================================================================

@app.get("/", summary="Verificação de status da API", tags=["Status"])
def read_root():
    return {"status": "API de Gestão de Notas de Crédito no ar."}

# --- AUTENTICAÇÃO ---

@app.post("/token", summary="Autentica e define um cookie HttpOnly com o token", tags=["Autenticação"])
async def login_for_access_token(response: Response, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        log_audit_action(db, form_data.username, "LOGIN_FAILED", "Tentativa de login com credenciais incorretas")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utilizador ou senha incorretos")

    access_token = create_access_token(data={"sub": user.username, "role": user.role.value})
    log_audit_action(db, user.username, "LOGIN_SUCCESS")

    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        samesite="none",
        secure=True,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
        domain=BACKEND_URL # **<-- CORREÇÃO FINAL**
    )
    return {"message": "Login bem-sucedido"}

@app.post("/logout", summary="Desloga o utilizador", tags=["Autenticação"])
def logout(response: Response, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    log_audit_action(db, current_user.username, "LOGOUT_SUCCESS")
    response.delete_cookie("access_token", domain=BACKEND_URL, path="/")
    return {"message": "Logout bem-sucedido"}

@app.get("/users/me", response_model=UserInDB, summary="Retorna informações do utilizador logado", tags=["Autenticação"])
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user


# --- ADMINISTRAÇÃO: UTILIZADORES ---

@app.post("/users", response_model=UserInDB, status_code=status.HTTP_201_CREATED, summary="Cria um novo utilizador (Apenas Admins)", tags=["Administração"])
def create_user(user: UserCreate, db: Session = Depends(get_db), admin_user: User = Depends(get_current_admin_user)):
    if db.query(User).filter(User.username == user.username).first():
        raise HTTPException(status_code=400, detail="Nome de utilizador já existe")
    if db.query(User).filter(User.email == user.email).first():
        raise HTTPException(status_code=400, detail="E-mail já registado")

    try:
        hashed_password = get_password_hash(user.password)
        new_user = User(username=user.username, email=user.email, hashed_password=hashed_password, role=user.role)
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
        log_audit_action(db, admin_user.username, "USER_CREATED", f"Utilizador '{user.username}' criado com perfil '{user.role.value}'.")
        return new_user
    except ValueError as ve:
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Ocorreu um erro ao criar o utilizador.")

@app.get("/users", response_model=List[UserInDB], summary="Lista todos os utilizadores (Apenas Admins)", tags=["Administração"])
def read_users(db: Session = Depends(get_db), admin_user: User = Depends(get_current_admin_user)):
    return db.query(User).order_by(User.username).all()

@app.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Exclui um utilizador (Apenas Admins)", tags=["Administração"])
def delete_user(user_id: int, db: Session = Depends(get_db), admin_user: User = Depends(get_current_admin_user)):
    if user_id == admin_user.id:
        raise HTTPException(status_code=400, detail="Não é permitido excluir o próprio utilizador.")
    
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Utilizador não encontrado.")
    
    username = db_user.username
    db.delete(db_user)
    db.commit()
    log_audit_action(db, admin_user.username, "USER_DELETED", f"Utilizador '{username}' (ID: {user_id}) foi excluído.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)

# --- ADMINISTRAÇÃO: SEÇÕES ---

@app.post("/secoes", response_model=SeçãoInDB, status_code=status.HTTP_201_CREATED, summary="Adiciona uma nova seção", tags=["Administração"])
def create_secao(secao: SeçãoCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    try:
        db_secao = Seção(nome=secao.nome)
        db.add(db_secao)
        db.commit()
        db.refresh(db_secao)
        log_audit_action(db, current_user.username, "SECTION_CREATED", f"Seção '{secao.nome}' criada.")
        return db_secao
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Uma seção com este nome já existe.")

@app.get("/secoes", response_model=List[SeçãoInDB], summary="Lista todas as seções", tags=["Administração"])
def read_secoes(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Seção).order_by(Seção.nome).all()

@app.put("/secoes/{secao_id}", response_model=SeçãoInDB, summary="Atualiza o nome de uma seção (Apenas Admins)", tags=["Administração"])
def update_secao(secao_id: int, secao_update: SeçãoCreate, db: Session = Depends(get_db), admin_user: User = Depends(get_current_admin_user)):
    db_secao = db.query(Seção).filter(Seção.id == secao_id).first()
    if not db_secao:
        raise HTTPException(status_code=404, detail="Seção não encontrada.")
    
    old_name = db_secao.nome
    db_secao.nome = secao_update.nome
    try:
        db.commit()
        db.refresh(db_secao)
        log_audit_action(db, admin_user.username, "SECTION_UPDATED", f"Seção '{old_name}' (ID: {secao_id}) renomeada para '{secao_update.nome}'.")
        return db_secao
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Uma seção com este novo nome já existe.")

@app.delete("/secoes/{secao_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Exclui uma seção (Apenas Admins)", tags=["Administração"])
def delete_secao(secao_id: int, db: Session = Depends(get_db), admin_user: User = Depends(get_current_admin_user)):
    db_secao = db.query(Seção).filter(Seção.id == secao_id).first()
    if not db_secao:
        raise HTTPException(status_code=404, detail="Seção não encontrada.")

    if db.query(NotaCredito).filter(NotaCredito.secao_responsavel_id == secao_id).first():
        raise HTTPException(status_code=400, detail=f"Não é possível excluir '{db_secao.nome}', pois está vinculada a Notas de Crédito.")
    if db.query(Empenho).filter(Empenho.secao_requisitante_id == secao_id).first():
        raise HTTPException(status_code=400, detail=f"Não é possível excluir '{db_secao.nome}', pois está vinculada a Empenhos.")
    
    secao_nome = db_secao.nome
    db.delete(db_secao)
    db.commit()
    log_audit_action(db, admin_user.username, "SECTION_DELETED", f"Seção '{secao_nome}' (ID: {secao_id}) foi excluída.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)

# --- NOTAS DE CRÉDITO ---

@app.post("/notas-credito", response_model=NotaCreditoInDB, status_code=status.HTTP_201_CREATED, summary="Cria uma nova Nota de Crédito", tags=["Notas de Crédito"])
def create_nota_credito(nc_in: NotaCreditoCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not db.query(Seção).filter(Seção.id == nc_in.secao_responsavel_id).first():
        raise HTTPException(status_code=404, detail="Seção responsável não encontrada.")

    try:
        db_nc = NotaCredito(**nc_in.dict(), saldo_disponivel=nc_in.valor, status="Ativa")
        db.add(db_nc)
        db.commit()
        db.refresh(db_nc)
        log_audit_action(db, current_user.username, "NC_CREATED", f"NC '{nc_in.numero_nc}' criada com valor R$ {nc_in.valor:,.2f}.")
        return db_nc
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Uma Nota de Crédito com este número já existe.")

@app.get("/notas-credito", response_model=PaginatedNCS, summary="Lista e filtra as Notas de Crédito", tags=["Notas de Crédito"])
def read_notas_credito(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=100),
    plano_interno: Optional[str] = Query(None, description="Filtrar por Plano Interno"),
    nd: Optional[str] = Query(None, description="Filtrar por Natureza de Despesa"),
    secao_responsavel_id: Optional[int] = Query(None, description="Filtrar por ID da Seção Responsável"),
    status: Optional[str] = Query(None, description="Filtrar por Status (Ex: Ativa)")
):
    query = db.query(NotaCredito)
    if plano_interno:
        query = query.filter(NotaCredito.plano_interno.ilike(f"%{plano_interno}%"))
    if nd:
        query = query.filter(NotaCredito.nd.ilike(f"%{nd}%"))
    if secao_responsavel_id:
        query = query.filter(NotaCredito.secao_responsavel_id == secao_responsavel_id)
    if status:
        query = query.filter(NotaCredito.status == status)
    
    total = query.count()
    results = query.order_by(desc(NotaCredito.data_chegada)).offset((page - 1) * size).limit(size).all()
    
    return {"total": total, "page": page, "size": size, "results": results}

@app.get("/notas-credito/{nc_id}", response_model=NotaCreditoInDB, summary="Obtém detalhes de uma Nota de Crédito", tags=["Notas de Crédito"])
def read_nota_credito(nc_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_nc = db.query(NotaCredito).filter(NotaCredito.id == nc_id).first()
    if not db_nc:
        raise HTTPException(status_code=404, detail="Nota de Crédito não encontrada.")
    return db_nc

@app.put("/notas-credito/{nc_id}", response_model=NotaCreditoInDB, summary="Atualiza uma Nota de Crédito", tags=["Notas de Crédito"])
def update_nota_credito(nc_id: int, nc_update: NotaCreditoCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_nc = db.query(NotaCredito).filter(NotaCredito.id == nc_id).first()
    if not db_nc:
        raise HTTPException(status_code=404, detail="Nota de Crédito não encontrada.")

    valor_ja_empenhado = db_nc.valor - db_nc.saldo_disponivel
    novo_saldo = nc_update.valor - valor_ja_empenhado
    if novo_saldo < -0.01: 
        raise HTTPException(status_code=400, detail="O novo valor total é menor que o valor já empenhado nesta NC.")

    update_data = nc_update.dict()
    for key, value in update_data.items():
        setattr(db_nc, key, value)
    
    db_nc.saldo_disponivel = novo_saldo

    try:
        db.commit()
        db.refresh(db_nc)
        log_audit_action(db, current_user.username, "NC_UPDATED", f"NC '{db_nc.numero_nc}' (ID: {nc_id}) atualizada.")
        return db_nc
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Já existe uma Nota de Crédito com o número informado.")

@app.delete("/notas-credito/{nc_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Exclui uma Nota de Crédito (Apenas Admins)", tags=["Notas de Crédito"])
def delete_nota_credito(nc_id: int, db: Session = Depends(get_db), admin_user: User = Depends(get_current_admin_user)):
    db_nc = db.query(NotaCredito).filter(NotaCredito.id == nc_id).first()
    if not db_nc:
        raise HTTPException(status_code=404, detail="Nota de Crédito não encontrada.")

    if db.query(Empenho).filter(Empenho.nota_credito_id == nc_id).first():
        raise HTTPException(status_code=400, detail=f"Não é possível excluir a NC '{db_nc.numero_nc}', pois ela possui empenho(s) vinculado(s).")
    
    nc_numero = db_nc.numero_nc
    db.delete(db_nc)
    db.commit()
    log_audit_action(db, admin_user.username, "NC_DELETED", f"NC '{nc_numero}' (ID: {nc_id}) foi excluída.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)

# --- EMPENHOS ---

@app.post("/empenhos", response_model=EmpenhoInDB, status_code=status.HTTP_201_CREATED, summary="Cria um novo Empenho", tags=["Empenhos"])
def create_empenho(empenho_in: EmpenhoCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    try:
        with db.begin_nested():
            db_nc = db.query(NotaCredito).filter(NotaCredito.id == empenho_in.nota_credito_id).with_for_update().first()
            if not db_nc:
                raise HTTPException(status_code=404, detail="Nota de Crédito não encontrada.")
            if db_nc.status != "Ativa":
                raise HTTPException(status_code=400, detail=f"Não é possível empenhar em uma NC com status '{db_nc.status}'.")
            if empenho_in.valor > db_nc.saldo_disponivel:
                raise HTTPException(status_code=400, detail=f"Valor do empenho (R$ {empenho_in.valor:,.2f}) excede o saldo disponível (R$ {db_nc.saldo_disponivel:,.2f}).")

            db_empenho = Empenho(**empenho_in.dict())
            db.add(db_empenho)

            db_nc.saldo_disponivel -= empenho_in.valor
            if db_nc.saldo_disponivel < 0.01:
                db_nc.saldo_disponivel = 0
                db_nc.status = "Totalmente Empenhada"

            db.commit() 
            log_audit_action(db, current_user.username, "EMPENHO_CREATED", f"Empenho '{empenho_in.numero_ne}' no valor de R$ {empenho_in.valor:,.2f} lançado na NC '{db_nc.numero_nc}'.")

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Um Empenho com este número de NE já existe.")
    except Exception as e:
        db.rollback()
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Ocorreu um erro inesperado: {str(e)}")

    db.refresh(db_empenho)
    return db_empenho


@app.get("/empenhos", response_model=PaginatedEmpenhos, summary="Lista e filtra Empenhos", tags=["Empenhos"])
def read_empenhos(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=100),
    nota_credito_id: Optional[int] = Query(None, description="Filtrar por ID da Nota de Crédito")
):
    query = db.query(Empenho)
    if nota_credito_id:
        query = query.filter(Empenho.nota_credito_id == nota_credito_id)

    total = query.count()
    results = query.order_by(desc(Empenho.data_empenho)).offset((page - 1) * size).limit(size).all()
    return {"total": total, "page": page, "size": size, "results": results}


@app.delete("/empenhos/{empenho_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Exclui um Empenho (Apenas Admins)", tags=["Empenhos"])
def delete_empenho(empenho_id: int, db: Session = Depends(get_db), admin_user: User = Depends(get_current_admin_user)):
    try:
        with db.begin_nested():
            db_empenho = db.query(Empenho).filter(Empenho.id == empenho_id).first()
            if not db_empenho:
                raise HTTPException(status_code=404, detail="Empenho não encontrado.")

            if db.query(AnulacaoEmpenho).filter(AnulacaoEmpenho.empenho_id == empenho_id).first():
                raise HTTPException(status_code=400, detail="Não é possível excluir empenho, pois ele possui anulações registadas.")

            db_nc = db.query(NotaCredito).filter(NotaCredito.id == db_empenho.nota_credito_id).with_for_update().first()

            if db_nc:
                db_nc.saldo_disponivel += db_empenho.valor
                if db_nc.status == "Totalmente Empenhada":
                    db_nc.status = "Ativa"

            empenho_numero = db_empenho.numero_ne
            nc_numero = db_nc.numero_nc if db_nc else "N/A"

            db.delete(db_empenho)
            db.commit()
            log_audit_action(db, admin_user.username, "EMPENHO_DELETED", f"Empenho '{empenho_numero}' (ID: {empenho_id}) foi excluído da NC '{nc_numero}'. Valor de R$ {db_empenho.valor:,.2f} devolvido ao saldo.")
    except Exception as e:
        db.rollback()
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Ocorreu um erro inesperado: {str(e)}")

    return Response(status_code=status.HTTP_204_NO_CONTENT)

# --- ANULAÇÕES E RECOLHIMENTOS ---

@app.post("/anulacoes-empenho", response_model=AnulacaoEmpenhoInDB, summary="Regista uma Anulação de Empenho", tags=["Anulações e Recolhimentos"])
def create_anulacao(anulacao_in: AnulacaoEmpenhoBase, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    try:
        with db.begin_nested():
            db_empenho = db.query(Empenho).filter(Empenho.id == anulacao_in.empenho_id).with_for_update().first()
            if not db_empenho:
                raise HTTPException(status_code=404, detail="Empenho a ser anulado não encontrado.")

            soma_anulacoes = db.query(func.sum(AnulacaoEmpenho.valor)).filter(AnulacaoEmpenho.empenho_id == db_empenho.id).scalar() or 0
            saldo_empenho = db_empenho.valor - soma_anulacoes
            if anulacao_in.valor > saldo_empenho:
                raise HTTPException(status_code=400, detail=f"Valor da anulação (R$ {anulacao_in.valor:,.2f}) excede o saldo executado do empenho (R$ {saldo_empenho:,.2f}).")

            db_nc = db.query(NotaCredito).filter(NotaCredito.id == db_empenho.nota_credito_id).with_for_update().first()
            if db_nc:
                db_nc.saldo_disponivel += anulacao_in.valor
                if db_nc.status == "Totalmente Empenhada":
                    db_nc.status = "Ativa"

            db_anulacao = AnulacaoEmpenho(**anulacao_in.dict())
            db.add(db_anulacao)
            db.commit()
            log_audit_action(db, current_user.username, "ANULACAO_CREATED", f"Anulação de R$ {anulacao_in.valor:,.2f} no empenho '{db_empenho.numero_ne}'.")
            db.refresh(db_anulacao)
            return db_anulacao
    except Exception as e:
        db.rollback()
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Ocorreu um erro inesperado: {str(e)}")

@app.post("/recolhimentos-saldo", response_model=RecolhimentoSaldoInDB, summary="Regista um Recolhimento de Saldo de uma NC", tags=["Anulações e Recolhimentos"])
def create_recolhimento(recolhimento_in: RecolhimentoSaldoBase, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    try:
        with db.begin_nested():
            db_nc = db.query(NotaCredito).filter(NotaCredito.id == recolhimento_in.nota_credito_id).with_for_update().first()
            if not db_nc:
                raise HTTPException(status_code=404, detail="Nota de Crédito não encontrada.")
            if recolhimento_in.valor > db_nc.saldo_disponivel:
                raise HTTPException(status_code=400, detail=f"Valor do recolhimento (R$ {recolhimento_in.valor:,.2f}) excede o saldo disponível da NC (R$ {db_nc.saldo_disponivel:,.2f}).")

            db_nc.saldo_disponivel -= recolhimento_in.valor

            db_recolhimento = RecolhimentoSaldo(**recolhimento_in.dict())
            db.add(db_recolhimento)
            db.commit()
            log_audit_action(db, current_user.username, "RECOLHIMENTO_CREATED", f"Recolhimento de saldo de R$ {recolhimento_in.valor:,.2f} da NC '{db_nc.numero_nc}'.")
            db.refresh(db_recolhimento)
            return db_recolhimento
    except Exception as e:
        db.rollback()
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Ocorreu um erro inesperado: {str(e)}")
        
@app.get("/anulacoes-empenho", response_model=List[AnulacaoEmpenhoInDB], summary="Lista anulações por empenho", tags=["Anulações e Recolhimentos"])
def read_anulacoes(empenho_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(AnulacaoEmpenho).filter(AnulacaoEmpenho.empenho_id == empenho_id).all()

@app.get("/recolhimentos-saldo", response_model=List[RecolhimentoSaldoInDB], summary="Lista recolhimentos por nota de crédito", tags=["Anulações e Recolhimentos"])
def read_recolhimentos(nota_credito_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(RecolhimentoSaldo).filter(RecolhimentoSaldo.nota_credito_id == nota_credito_id).all()

# --- DASHBOARD E RELATÓRIOS ---

@app.get("/dashboard/kpis", summary="Retorna os KPIs principais do dashboard", tags=["Dashboard"])
def get_dashboard_kpis(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    saldo_total = db.query(func.sum(NotaCredito.saldo_disponivel)).scalar() or 0.0
    ncs_ativas = db.query(NotaCredito).filter(NotaCredito.status == "Ativa").count()
    
    soma_empenhos = db.query(func.sum(Empenho.valor)).scalar() or 0.0
    soma_anulacoes = db.query(func.sum(AnulacaoEmpenho.valor)).scalar() or 0.0
    valor_empenhado_liquido = (soma_empenhos or 0.0) - (soma_anulacoes or 0.0)

    return {
        "saldo_disponivel_total": saldo_total,
        "valor_empenhado_total": valor_empenhado_liquido,
        "ncs_ativas": ncs_ativas
    }

@app.get("/dashboard/avisos", response_model=List[NotaCreditoInDB], summary="Retorna NCs com prazo de empenho próximo", tags=["Dashboard"])
def get_dashboard_avisos(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    data_limite = date.today() + timedelta(days=7) 
    avisos = db.query(NotaCredito).filter(
        NotaCredito.prazo_empenho <= data_limite,
        NotaCredito.status == "Ativa"
    ).order_by(NotaCredito.prazo_empenho).all()
    return avisos

@app.get("/relatorios/pdf", summary="Gera um relatório consolidado em PDF", tags=["Relatórios"])
def get_relatorio_pdf(
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user),
    plano_interno: Optional[str] = Query(None),
    nd: Optional[str] = Query(None),
    secao_responsavel_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None)
):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), topMargin=0.5*inch, bottomMargin=0.5*inch)
    styles = getSampleStyleSheet()
    styles['h2'].alignment = 1
    styles['h1'].alignment = 1
    styles['Normal'].fontSize = 8
    
    elements = []

    header_text = "MINISTÉRIO DA DEFESA<br/>EXÉRCITO BRASILEIRO<br/>2º CENTRO DE GEOINFORMAÇÃO"
    elements.append(Paragraph(header_text, styles['h2']))
    elements.append(Spacer(1, 0.2*inch))
    
    titulo = "RELATÓRIO GERAL DE NOTAS DE CRÉDITO"
    
    elements.append(Paragraph(titulo, styles['h1']))
    elements.append(Paragraph(f"Gerado por: {current_user.username} em {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}", styles['Normal']))
    elements.append(Spacer(1, 0.25*inch))

    query = db.query(NotaCredito).order_by(NotaCredito.plano_interno)
    
    # Aplicação de Filtros
    if plano_interno: query = query.filter(NotaCredito.plano_interno.ilike(f"%{plano_interno}%"))
    if nd: query = query.filter(NotaCredito.nd.ilike(f"%{nd}%"))
    if secao_responsavel_id: query = query.filter(NotaCredito.secao_responsavel_id == secao_responsavel_id)
    if status: query = query.filter(NotaCredito.status.ilike(f"%{status}%"))
    
    ncs = query.all()
    
    table_data = [["PI", "ND", "Nº da NC", "Seção", "Valor Original", "Saldo Disponível", "Status", "Prazo"]]
    for nc in ncs:
        table_data.append([
            nc.plano_interno, nc.nd, nc.numero_nc, nc.secao_responsavel.nome,
            f"R$ {nc.valor:,.2f}", f"R$ {nc.saldo_disponivel:,.2f}", nc.status,
            nc.prazo_empenho.strftime("%d/%m/%Y")
        ])

    table = Table(table_data, colWidths=[1.5*inch, 1*inch, 2*inch, 1.5*inch, 1.5*inch, 1.5*inch, 1*inch, 1*inch])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#003366")),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
        ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor("#f0f0f0")),
        ('GRID', (0, 0), (-1, -1), 1, colors.black)
    ]))
    
    elements.append(table)
    doc.build(elements)
    buffer.seek(0)
    
    headers = {'Content-Disposition': 'inline; filename="relatorio_salc.pdf"'}
    log_audit_action(db, current_user.username, "REPORT_GENERATED", f"Filtros: PI={plano_interno}, ND={nd}, Seção={secao_responsavel_id}, Status={status}")
    return Response(content=buffer.getvalue(), media_type='application/pdf', headers=headers)

# --- AUDITORIA ---

@app.get("/audit-logs", response_model=List[AuditLogInDB], summary="Retorna o log de auditoria do sistema (Apenas Admins)", tags=["Auditoria"])
def read_audit_logs(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_current_admin_user)
):
    logs = db.query(AuditLog).order_by(desc(AuditLog.timestamp)).offset(skip).limit(limit).all()
    return logs
