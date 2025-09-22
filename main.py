import os
import io
import enum
import re
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, status, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
from sqlalchemy import create_engine, Column, Integer, String, Float, Date, ForeignKey, DateTime, Enum as SQLAlchemyEnum, desc, Boolean
from sqlalchemy.orm import sessionmaker, Session, relationship, DeclarativeBase, joinedload
from sqlalchemy.exc import IntegrityError
from sqlalchemy.sql import func
from dotenv import load_dotenv
import pandas as pd

# --- Segurança e Autenticação ---
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

# --- PDF Reporting ---
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch

load_dotenv()

# ==============================================================================
# 1. CONFIGURAÇÃO INICIAL E DE SEGURANÇA
# ==============================================================================

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 120

if not SECRET_KEY:
    raise RuntimeError("FATAL: A variável de ambiente SECRET_KEY não está configurada.")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

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
    status = Column(String, nullable=True, index=True)
    is_fake = Column(Boolean, default=False, nullable=False)
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

class Token(BaseModel):
    access_token: str
    token_type: str

class UserBase(BaseModel):
    username: str

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
    valor: float = Field(..., ge=0)
    data_empenho: date
    observacao: Optional[str] = None
    nota_credito_id: int
    secao_requisitante_id: int
    is_fake: bool = False

class EmpenhoCreate(EmpenhoBase):
    pass

class EmpenhoInDB(EmpenhoBase):
    id: int
    status: Optional[str] = None
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

app = FastAPI(title="Sistema de Gestão de Notas de Crédito", version="2.7.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True, 
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_password_hash(password):
    return pwd_context.hash(password)

@app.on_event("startup")
def on_startup():
    print("Iniciando aplicação...")
    Base.metadata.create_all(bind=engine)
    print("Tabelas criadas (se não existiam).")

    db = SessionLocal()
    try:
        user = db.query(User).first()
        if user is None:
            print("Nenhum usuário encontrado. Criando usuário 'admin' padrão...")
            default_admin = User(
                username="admin",
                hashed_password=get_password_hash("admin1234"),
                role=UserRole.ADMINISTRADOR
            )
            db.add(default_admin)
            db.commit()
            print("Usuário 'admin' criado com sucesso. Use a senha 'admin1234' para o primeiro login.")
        else:
            print("Usuário(s) já existente(s). Nenhum usuário padrão foi criado.")
    finally:
        db.close()
    
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

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciais inválidas. Por favor, faça login novamente.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
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

@app.post("/token", response_model=Token, summary="Autentica o utilizador e retorna um token JWT", tags=["Autenticação"])
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        log_audit_action(db, form_data.username, "LOGIN_FAILED", "Tentativa de login com credenciais incorretas")
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utilizador ou senha incorretos")

    access_token = create_access_token(data={"sub": user.username, "role": user.role.value})
    log_audit_action(db, user.username, "LOGIN_SUCCESS")
    db.commit()
    
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/users/me", response_model=UserInDB, summary="Retorna informações do utilizador logado", tags=["Autenticação"])
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user

# --- ADMINISTRAÇÃO ---

@app.post("/users", response_model=UserInDB, status_code=status.HTTP_201_CREATED, summary="Cria um novo utilizador", tags=["Administração"])
def create_user(user: UserCreate, db: Session = Depends(get_db), admin_user: User = Depends(get_current_admin_user)):
    if db.query(User).filter(User.username == user.username).first():
        raise HTTPException(status_code=400, detail="Nome de utilizador já existe")

    try:
        hashed_password = get_password_hash(user.password)
        new_user = User(username=user.username, hashed_password=hashed_password, role=user.role)
        db.add(new_user)
        log_audit_action(db, admin_user.username, "USER_CREATED", f"Utilizador '{user.username}' criado com perfil '{user.role.value}'.")
        db.commit()
        db.refresh(new_user)
        return new_user
    except ValueError as ve:
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Ocorreu um erro ao criar o utilizador.")

@app.get("/users", response_model=List[UserInDB], summary="Lista todos os utilizadores", tags=["Administração"])
def read_users(db: Session = Depends(get_db), admin_user: User = Depends(get_current_admin_user)):
    return db.query(User).order_by(User.username).all()

@app.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Exclui um utilizador", tags=["Administração"])
def delete_user(user_id: int, db: Session = Depends(get_db), admin_user: User = Depends(get_current_admin_user)):
    if user_id == admin_user.id:
        raise HTTPException(status_code=400, detail="Não é permitido excluir o próprio utilizador.")
    
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Utilizador não encontrado.")
    
    username = db_user.username
    db.delete(db_user)
    log_audit_action(db, admin_user.username, "USER_DELETED", f"Utilizador '{username}' (ID: {user_id}) foi excluído.")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

@app.post("/secoes", response_model=SeçãoInDB, status_code=status.HTTP_201_CREATED, summary="Adiciona uma nova seção", tags=["Administração"])
def create_secao(secao: SeçãoCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    try:
        db_secao = Seção(nome=secao.nome)
        db.add(db_secao)
        log_audit_action(db, current_user.username, "SECTION_CREATED", f"Seção '{secao.nome}' criada.")
        db.commit()
        db.refresh(db_secao)
        return db_secao
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Uma seção com este nome já existe.")

@app.get("/secoes", response_model=List[SeçãoInDB], summary="Lista todas as seções", tags=["Administração"])
def read_secoes(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Seção).order_by(Seção.nome).all()

@app.put("/secoes/{secao_id}", response_model=SeçãoInDB, summary="Atualiza o nome de uma seção", tags=["Administração"])
def update_secao(secao_id: int, secao_update: SeçãoCreate, db: Session = Depends(get_db), admin_user: User = Depends(get_current_admin_user)):
    db_secao = db.query(Seção).filter(Seção.id == secao_id).first()
    if not db_secao:
        raise HTTPException(status_code=404, detail="Seção não encontrada.")
    
    old_name = db_secao.nome
    db_secao.nome = secao_update.nome
    try:
        log_audit_action(db, admin_user.username, "SECTION_UPDATED", f"Seção '{old_name}' (ID: {secao_id}) renomeada para '{secao_update.nome}'.")
        db.commit()
        db.refresh(db_secao)
        return db_secao
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Uma seção com este novo nome já existe.")

@app.delete("/secoes/{secao_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Exclui uma seção", tags=["Administração"])
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
    log_audit_action(db, admin_user.username, "SECTION_DELETED", f"Seção '{secao_nome}' (ID: {secao_id}) foi excluída.")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

# --- NOTAS DE CRÉDITO ---

@app.post("/notas-credito", response_model=NotaCreditoInDB, status_code=status.HTTP_201_CREATED, summary="Cria uma nova Nota de Crédito", tags=["Notas de Crédito"])
def create_nota_credito(nc_in: NotaCreditoCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not db.query(Seção).filter(Seção.id == nc_in.secao_responsavel_id).first():
        raise HTTPException(status_code=404, detail="Seção responsável não encontrada.")
    try:
        db_nc = NotaCredito(**nc_in.dict(), saldo_disponivel=nc_in.valor, status="Ativa")
        db.add(db_nc)
        log_audit_action(db, current_user.username, "NC_CREATED", f"NC '{nc_in.numero_nc}' criada com valor R$ {nc_in.valor:,.2f}.")
        db.commit()
        db.refresh(db_nc)
        return db_nc
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Uma Nota de Crédito com este número já existe.")

@app.get("/notas-credito", response_model=PaginatedNCS, summary="Lista e filtra as Notas de Crédito", tags=["Notas de Crédito"])
def read_notas_credito(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user), page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=1000), plano_interno: Optional[str] = Query(None), nd: Optional[str] = Query(None),
    secao_responsavel_id: Optional[int] = Query(None), status: Optional[str] = Query(None)
):
    query = db.query(NotaCredito).options(joinedload(NotaCredito.secao_responsavel))
    if plano_interno: query = query.filter(NotaCredito.plano_interno.ilike(f"%{plano_interno}%"))
    if nd: query = query.filter(NotaCredito.nd.ilike(f"%{nd}%"))
    if secao_responsavel_id: query = query.filter(NotaCredito.secao_responsavel_id == secao_responsavel_id)
    if status: query = query.filter(NotaCredito.status == status)
    total = query.count()
    results = query.order_by(desc(NotaCredito.data_chegada)).offset((page - 1) * size).limit(size).all()
    return {"total": total, "page": page, "size": size, "results": results}

@app.get("/notas-credito/distinct/plano-interno", response_model=List[str], summary="Obtém Planos Internos únicos", tags=["Notas de Crédito"])
def get_distinct_plano_interno(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    results = db.query(NotaCredito.plano_interno).distinct().order_by(NotaCredito.plano_interno).all()
    return [result[0] for result in results if result[0]]

@app.get("/notas-credito/distinct/nd", response_model=List[str], summary="Obtém Naturezas de Despesa únicas", tags=["Notas de Crédito"])
def get_distinct_nd(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    results = db.query(NotaCredito.nd).distinct().order_by(NotaCredito.nd).all()
    return [result[0] for result in results if result[0]]

@app.get("/notas-credito/{nc_id}", response_model=NotaCreditoInDB, summary="Obtém detalhes de uma Nota de Crédito", tags=["Notas de Crédito"])
def read_nota_credito(nc_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_nc = db.query(NotaCredito).options(joinedload(NotaCredito.secao_responsavel)).filter(NotaCredito.id == nc_id).first()
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
    for key, value in nc_update.dict().items():
        setattr(db_nc, key, value)
    db_nc.saldo_disponivel = novo_saldo
    try:
        log_audit_action(db, current_user.username, "NC_UPDATED", f"NC '{db_nc.numero_nc}' (ID: {nc_id}) atualizada.")
        db.commit()
        db.refresh(db_nc)
        return db_nc
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Já existe uma Nota de Crédito com o número informado.")

@app.delete("/notas-credito/{nc_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Exclui uma Nota de Crédito", tags=["Notas de Crédito"])
def delete_nota_credito(nc_id: int, db: Session = Depends(get_db), admin_user: User = Depends(get_current_admin_user)):
    db_nc = db.query(NotaCredito).filter(NotaCredito.id == nc_id).first()
    if not db_nc:
        raise HTTPException(status_code=404, detail="Nota de Crédito não encontrada.")
    if db.query(Empenho).filter(Empenho.nota_credito_id == nc_id).first():
        raise HTTPException(status_code=400, detail=f"Não é possível excluir a NC '{db_nc.numero_nc}', pois ela possui empenho(s) vinculado(s).")
    nc_numero = db_nc.numero_nc
    db.delete(db_nc)
    log_audit_action(db, admin_user.username, "NC_DELETED", f"NC '{nc_numero}' (ID: {nc_id}) foi excluída.")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

# --- EMPENHOS ---

@app.post("/empenhos", response_model=EmpenhoInDB, status_code=status.HTTP_201_CREATED, summary="Cria um novo Empenho", tags=["Empenhos"])
def create_empenho(empenho_in: EmpenhoCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_nc = db.query(NotaCredito).filter(NotaCredito.id == empenho_in.nota_credito_id).with_for_update().first()
    if not db_nc:
        raise HTTPException(status_code=404, detail="Nota de Crédito associada não encontrada.")
    if db_nc.status != "Ativa":
        raise HTTPException(status_code=400, detail=f"Não é possível empenhar em uma NC com status '{db_nc.status}'.")
    if empenho_in.valor > db_nc.saldo_disponivel:
        raise HTTPException(status_code=400, detail=f"Valor do empenho (R$ {empenho_in.valor:,.2f}) excede o saldo disponível (R$ {db_nc.saldo_disponivel:,.2f}).")
    
    try:
        db_empenho = Empenho(**empenho_in.dict())
        db.add(db_empenho)
        
        db_nc.saldo_disponivel -= empenho_in.valor
        if db_nc.saldo_disponivel < 0.01:
            db_nc.saldo_disponivel = 0
            db_nc.status = "Totalmente Empenhada"
        
        log_audit_action(db, current_user.username, "EMPENHO_CREATED", f"Empenho '{empenho_in.numero_ne}' no valor de R$ {empenho_in.valor:,.2f} lançado na NC '{db_nc.numero_nc}'.")
        
        db.commit()
        
        empenho_completo = db.query(Empenho).options(
            joinedload(Empenho.secao_requisitante),
            joinedload(Empenho.nota_credito).joinedload(NotaCredito.secao_responsavel)
        ).filter(Empenho.id == db_empenho.id).first()

        return empenho_completo

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Um Empenho com este número de NE já existe.")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Ocorreu um erro inesperado: {str(e)}")


@app.get("/empenhos", response_model=PaginatedEmpenhos, summary="Lista e filtra Empenhos", tags=["Empenhos"])
def read_empenhos(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user), page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=1000), nota_credito_id: Optional[int] = Query(None)
):
    query = db.query(Empenho).options(
        joinedload(Empenho.secao_requisitante),
        joinedload(Empenho.nota_credito).joinedload(NotaCredito.secao_responsavel)
    )
    if nota_credito_id:
        query = query.filter(Empenho.nota_credito_id == nota_credito_id)
    total = query.count()
    results = query.order_by(desc(Empenho.data_empenho)).offset((page - 1) * size).limit(size).all()
    return {"total": total, "page": page, "size": size, "results": results}

@app.delete("/empenhos/{empenho_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Exclui um Empenho", tags=["Empenhos"])
def delete_empenho(empenho_id: int, db: Session = Depends(get_db), admin_user: User = Depends(get_current_admin_user)):
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
    log_audit_action(db, admin_user.username, "EMPENHO_DELETED", f"Empenho '{empenho_numero}' (ID: {empenho_id}) excluído. Valor de R$ {db_empenho.valor:,.2f} devolvido ao saldo.")
    db.delete(db_empenho)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

# --- ANULAÇÕES E RECOLHIMENTOS ---

@app.post("/anulacoes-empenho", response_model=AnulacaoEmpenhoInDB, summary="Regista uma Anulação de Empenho", tags=["Anulações e Recolhimentos"])
def create_anulacao(anulacao_in: AnulacaoEmpenhoBase, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_empenho = db.query(Empenho).filter(Empenho.id == anulacao_in.empenho_id).with_for_update().first()
    if not db_empenho:
        raise HTTPException(status_code=404, detail="Empenho a ser anulado não encontrado.")
    
    if anulacao_in.valor > db_empenho.valor:
        raise HTTPException(status_code=400, detail=f"Valor da anulação (R$ {anulacao_in.valor:,.2f}) excede o saldo executado do empenho (R$ {db_empenho.valor:,.2f}).")
    
    db_nc = db.query(NotaCredito).filter(NotaCredito.id == db_empenho.nota_credito_id).with_for_update().first()
    if db_nc:
        db_nc.saldo_disponivel += anulacao_in.valor
        if db_nc.status == "Totalmente Empenhada":
            db_nc.status = "Ativa"

    db_empenho.valor -= anulacao_in.valor
    if db_empenho.valor < 0.01:
        db_empenho.valor = 0
        db_empenho.status = "Anulação Total Realizada"
    else:
        db_empenho.status = "Anulação Parcial Realizada"

    db_anulacao = AnulacaoEmpenho(**anulacao_in.dict())
    db.add(db_anulacao)
    log_audit_action(db, current_user.username, "ANULACAO_CREATED", f"Anulação de R$ {anulacao_in.valor:,.2f} no empenho '{db_empenho.numero_ne}'. Saldo do empenho agora é R$ {db_empenho.valor:,.2f}.")
    db.commit()
    db.refresh(db_anulacao)
    return db_anulacao

@app.post("/recolhimentos-saldo", response_model=RecolhimentoSaldoInDB, summary="Regista um Recolhimento de Saldo", tags=["Anulações e Recolhimentos"])
def create_recolhimento(recolhimento_in: RecolhimentoSaldoBase, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_nc = db.query(NotaCredito).filter(NotaCredito.id == recolhimento_in.nota_credito_id).with_for_update().first()
    if not db_nc:
        raise HTTPException(status_code=404, detail="Nota de Crédito não encontrada.")
    if recolhimento_in.valor > db_nc.saldo_disponivel:
        raise HTTPException(status_code=400, detail=f"Valor do recolhimento (R$ {recolhimento_in.valor:,.2f}) excede o saldo disponível da NC (R$ {db_nc.saldo_disponivel:,.2f}).")
    db_nc.saldo_disponivel -= recolhimento_in.valor
    if db_nc.saldo_disponivel < 0.01:
        db_nc.saldo_disponivel = 0
        db_nc.status = "Totalmente Empenhada"
    db_recolhimento = RecolhimentoSaldo(**recolhimento_in.dict())
    db.add(db_recolhimento)
    log_audit_action(db, current_user.username, "RECOLHIMENTO_CREATED", f"Recolhimento de saldo de R$ {recolhimento_in.valor:,.2f} da NC '{db_nc.numero_nc}'.")
    db.commit()
    db.refresh(db_recolhimento)
    return db_recolhimento
        
@app.get("/anulacoes-empenho", response_model=List[AnulacaoEmpenhoInDB], summary="Lista anulações por empenho", tags=["Anulações e Recolhimentos"])
def read_anulacoes(empenho_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(AnulacaoEmpenho).filter(AnulacaoEmpenho.empenho_id == empenho_id).all()

@app.get("/recolhimentos-saldo", response_model=List[RecolhimentoSaldoInDB], summary="Lista recolhimentos por nota de crédito", tags=["Anulações e Recolhimentos"])
def read_recolhimentos(nota_credito_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(RecolhimentoSaldo).filter(RecolhimentoSaldo.nota_credito_id == nota_credito_id).all()

# --- DASHBOARD E RELATÓRIOS ---

@app.get("/dashboard/kpis", summary="Retorna os KPIs principais do dashboard", tags=["Dashboard"])
def get_dashboard_kpis(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    try:
        saldo_total_nc = db.query(func.sum(NotaCredito.saldo_disponivel)).scalar() or 0.0
        ncs_ativas = db.query(NotaCredito).filter(NotaCredito.status == "Ativa").count()
        valor_total_empenhos_fake = db.query(func.sum(Empenho.valor)).filter(Empenho.is_fake == True).scalar() or 0.0

        return {
            "saldo_disponivel_total": saldo_total_nc,
            "ncs_ativas": ncs_ativas,
            "valor_total_empenhos_fake": valor_total_empenhos_fake
        }
    except Exception as e:
        print(f"ERRO EM /dashboard/kpis: {e}")
        raise HTTPException(status_code=500, detail="Erro interno ao processar os KPIs do dashboard.")

@app.get("/dashboard/avisos", response_model=List[NotaCreditoInDB], summary="Retorna NCs com prazo de empenho próximo", tags=["Dashboard"])
def get_dashboard_avisos(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    data_limite = date.today() + timedelta(days=7) 
    avisos = db.query(NotaCredito).options(joinedload(NotaCredito.secao_responsavel)).filter(
        NotaCredito.prazo_empenho <= data_limite,
        NotaCredito.status == "Ativa"
    ).order_by(NotaCredito.prazo_empenho).all()
    return avisos

def get_all_data_for_report(db: Session, model, filters: dict):
    query = db.query(model)
    if model == NotaCredito:
        query = query.options(joinedload(NotaCredito.secao_responsavel))
        if filters.get("plano_interno"): query = query.filter(NotaCredito.plano_interno.ilike(f"%{filters['plano_interno']}%"))
        if filters.get("nd"): query = query.filter(NotaCredito.nd.ilike(f"%{filters['nd']}%"))
        if filters.get("secao_responsavel_id"): query = query.filter(NotaCredito.secao_responsavel_id == filters['secao_responsavel_id'])
        if filters.get("status"): query = query.filter(NotaCredito.status == filters['status'])
        query = query.order_by(desc(NotaCredito.data_chegada))
    elif model == Empenho:
        query = query.options(joinedload(Empenho.secao_requisitante), joinedload(Empenho.nota_credito).joinedload(NotaCredito.secao_responsavel))
        query = query.order_by(desc(Empenho.data_empenho))
    return query.all()

@app.get("/relatorios/excel/notas-credito", summary="Exporta Notas de Crédito para Excel", tags=["Relatórios"])
def export_nc_excel(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
    plano_interno: Optional[str] = Query(None), nd: Optional[str] = Query(None),
    secao_responsavel_id: Optional[int] = Query(None), status: Optional[str] = Query(None)
):
    filters = {
        "plano_interno": plano_interno, "nd": nd,
        "secao_responsavel_id": secao_responsavel_id, "status": status
    }
    ncs = get_all_data_for_report(db, NotaCredito, filters)
    
    data_to_export = [{
        "Nº da NC": nc.numero_nc, "Plano Interno": nc.plano_interno, "ND": nc.nd,
        "Seção Responsável": nc.secao_responsavel.nome, "Valor Original (R$)": nc.valor,
        "Saldo Disponível (R$)": nc.saldo_disponivel, "Status": nc.status,
        "Data de Chegada": nc.data_chegada.strftime('%d/%m/%Y'),
        "Prazo para Empenho": nc.prazo_empenho.strftime('%d/%m/%Y'),
        "Esfera": nc.esfera, "Fonte": nc.fonte, "PTRES": nc.ptres,
        "Descrição": nc.descricao
    } for nc in ncs]

    df = pd.DataFrame(data_to_export)
    
    if not df.empty:
        total_row = pd.DataFrame([{
            "Nº da NC": "TOTAL GERAL",
            "Valor Original (R$)": df["Valor Original (R$)"].sum(),
            "Saldo Disponível (R$)": df["Saldo Disponível (R$)"].sum()
        }])
        df = pd.concat([df, total_row], ignore_index=True)

    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Notas de Crédito')
    
    log_audit_action(db, current_user.username, "NC_EXPORT_EXCEL", f"Exportação de {len(ncs)} NCs.")
    db.commit()

    headers = {'Content-Disposition': 'attachment; filename="relatorio_notas_credito.xlsx"'}
    return Response(content=output.getvalue(), media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', headers=headers)

@app.get("/relatorios/excel/empenhos", summary="Exporta Empenhos para Excel", tags=["Relatórios"])
def export_empenhos_excel(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    empenhos = get_all_data_for_report(db, Empenho, {})
    
    data_to_export = [{
        "Nº do Empenho": e.numero_ne, "NC Associada": e.nota_credito.numero_nc,
        "Seção Requisitante": e.secao_requisitante.nome, "Valor (R$)": e.valor,
        "Data do Empenho": e.data_empenho.strftime('%d/%m/%Y'), "É Fake?": "Sim" if e.is_fake else "Não",
        "Status": e.status or "OK", "Observação": e.observacao
    } for e in empenhos]
    
    df = pd.DataFrame(data_to_export)

    if not df.empty:
        total_row = pd.DataFrame([{"Nº do Empenho": "TOTAL GERAL", "Valor (R$)": df["Valor (R$)"].sum()}])
        df = pd.concat([df, total_row], ignore_index=True)

    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Empenhos')
        
    log_audit_action(db, current_user.username, "EMPENHO_EXPORT_EXCEL", f"Exportação de {len(empenhos)} empenhos.")
    db.commit()

    headers = {'Content-Disposition': 'attachment; filename="relatorio_empenhos.xlsx"'}
    return Response(content=output.getvalue(), media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', headers=headers)

@app.get("/relatorios/excel/geral", summary="Exporta um relatório consolidado para Excel", tags=["Relatórios"])
def export_geral_excel(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
    plano_interno: Optional[str] = Query(None), nd: Optional[str] = Query(None),
    secao_responsavel_id: Optional[int] = Query(None), status: Optional[str] = Query(None),
    incluir_detalhes: bool = Query(False)
):
    query = db.query(NotaCredito).options(
        joinedload(NotaCredito.secao_responsavel),
        joinedload(NotaCredito.empenhos).joinedload(Empenho.secao_requisitante),
        joinedload(NotaCredito.recolhimentos)
    ).order_by(NotaCredito.plano_interno)
    
    if plano_interno: query = query.filter(NotaCredito.plano_interno.ilike(f"%{plano_interno}%"))
    if nd: query = query.filter(NotaCredito.nd.ilike(f"%{nd}%"))
    if secao_responsavel_id: query = query.filter(NotaCredito.secao_responsavel_id == secao_responsavel_id)
    if status: query = query.filter(NotaCredito.status.ilike(f"%{status}%"))
    ncs = query.all()

    data_to_export = []
    for nc in ncs:
        data_to_export.append({
            "Tipo de Registro": "Nota de Crédito",
            "Nº NC / NE": nc.numero_nc,
            "Plano Interno": nc.plano_interno,
            "ND": nc.nd,
            "Seção": nc.secao_responsavel.nome,
            "Valor (R$)": nc.valor,
            "Saldo Disponível (R$)": nc.saldo_disponivel,
            "Data": nc.prazo_empenho.strftime('%d/%m/%Y'),
            "Status / Obs": nc.status,
        })
        if incluir_detalhes:
            for e in nc.empenhos:
                data_to_export.append({
                    "Tipo de Registro": ">> Empenho",
                    "Nº NC / NE": e.numero_ne,
                    "Plano Interno": "", "ND": "",
                    "Seção": e.secao_requisitante.nome,
                    "Valor (R$)": e.valor,
                    "Saldo Disponível (R$)": "",
                    "Data": e.data_empenho.strftime('%d/%m/%Y'),
                    "Status / Obs": e.status or ('FAKE' if e.is_fake else ''),
                })
            for r in nc.recolhimentos:
                 data_to_export.append({
                    "Tipo de Registro": ">> Recolhimento",
                    "Nº NC / NE": "", "Plano Interno": "", "ND": "", "Seção": "",
                    "Valor (R$)": r.valor,
                    "Saldo Disponível (R$)": "",
                    "Data": r.data.strftime('%d/%m/%Y'),
                    "Status / Obs": r.observacao or '',
                })

    df = pd.DataFrame(data_to_export)
    
    if not df.empty:
        nc_df = df[df['Tipo de Registro'] == 'Nota de Crédito']
        total_valor = nc_df['Valor (R$)'].sum()
        total_saldo = nc_df['Saldo Disponível (R$)'].sum()
        
        total_row = pd.DataFrame([{
            "Tipo de Registro": "TOTAL GERAL",
            "Valor (R$)": total_valor,
            "Saldo Disponível (R$)": total_saldo
        }])
        df = pd.concat([df, total_row], ignore_index=True)

    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Relatório Geral')
    
    log_audit_action(db, current_user.username, "GENERAL_REPORT_EXCEL", f"Exportação de relatório geral com {len(ncs)} NCs.")
    db.commit()

    headers = {'Content-Disposition': 'attachment; filename="relatorio_geral_salc.xlsx"'}
    return Response(content=output.getvalue(), media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', headers=headers)


@app.get("/relatorios/pdf", summary="Gera um relatório consolidado em PDF", tags=["Relatórios"])
def get_relatorio_pdf(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
    plano_interno: Optional[str] = Query(None), nd: Optional[str] = Query(None),
    secao_responsavel_id: Optional[int] = Query(None), status: Optional[str] = Query(None),
    incluir_detalhes: bool = Query(False, description="Incluir detalhes de empenhos e recolhimentos no relatório")
):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), topMargin=0.5*inch, bottomMargin=0.5*inch)
    styles = getSampleStyleSheet()
    
    elements = []
    header_text = "MINISTÉRIO DA DEFESA<br/>EXÉRCITO BRASILEIRO<br/>2º CENTRO DE GEOINFORMAÇÃO"
    elements.append(Paragraph(header_text, styles['h2']))
    elements.append(Spacer(1, 0.2*inch))
    titulo = "RELATÓRIO GERAL DE NOTAS DE CRÉDITO"
    elements.append(Paragraph(titulo, styles['h1']))
    elements.append(Paragraph(f"Gerado por: {current_user.username} em {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}", styles['Normal']))
    elements.append(Spacer(1, 0.25*inch))
    
    query = db.query(NotaCredito).options(
        joinedload(NotaCredito.secao_responsavel),
        joinedload(NotaCredito.empenhos),
        joinedload(NotaCredito.recolhimentos)
    ).order_by(NotaCredito.plano_interno)
    
    if plano_interno: query = query.filter(NotaCredito.plano_interno.ilike(f"%{plano_interno}%"))
    if nd: query = query.filter(NotaCredito.nd.ilike(f"%{nd}%"))
    if secao_responsavel_id: query = query.filter(NotaCredito.secao_responsavel_id == secao_responsavel_id)
    if status: query = query.filter(NotaCredito.status.ilike(f"%{status}%"))
    ncs = query.all()
    
    for nc in ncs:
        nc_data = [[
            Paragraph(f"<b>NC:</b> {nc.numero_nc}", styles['Normal']),
            Paragraph(f"<b>PI:</b> {nc.plano_interno}", styles['Normal']),
            Paragraph(f"<b>ND:</b> {nc.nd}", styles['Normal']),
            Paragraph(f"<b>Seção:</b> {nc.secao_responsavel.nome}", styles['Normal']),
        ], [
            Paragraph(f"<b>Valor:</b> R$ {nc.valor:,.2f}", styles['Normal']),
            Paragraph(f"<b>Saldo:</b> R$ {nc.saldo_disponivel:,.2f}", styles['Normal']),
            Paragraph(f"<b>Status:</b> {nc.status}", styles['Normal']),
            Paragraph(f"<b>Prazo:</b> {nc.prazo_empenho.strftime('%d/%m/%Y')}", styles['Normal']),
        ]]
        
        tbl = Table(nc_data, colWidths=[2.7*inch, 2.7*inch, 2.7*inch, 2.7*inch])
        tbl.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#E6E6E6")),
            ('GRID', (0,0), (-1,-1), 1, colors.black),
            ('BOX', (0,0), (-1,-1), 2, colors.black),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ]))
        elements.append(tbl)
        
        if incluir_detalhes and (nc.empenhos or nc.recolhimentos):
            elements.append(Spacer(1, 0.1*inch))
            details_data = []
            if nc.empenhos:
                details_data.append([Paragraph("<b>Empenhos da NC</b>", styles['Normal']), "", "", "", ""])
                details_data.append(["Nº da NE", "Valor (Saldo)", "Data", "Status", "Observação"])
                for e in nc.empenhos:
                    status_empenho = e.status or ('FAKE' if e.is_fake else 'OK')
                    details_data.append([e.numero_ne, f"R$ {e.valor:,.2f}", e.data_empenho.strftime('%d/%m/%Y'), status_empenho, e.observacao or ''])
            
            if nc.recolhimentos:
                details_data.append([Paragraph("<b>Recolhimentos da NC</b>", styles['Normal']), "", ""])
                details_data.append(["Valor", "Data", "Observação"])
                for r in nc.recolhimentos:
                    details_data.append([f"R$ {r.valor:,.2f}", r.data.strftime('%d/%m/%Y'), r.observacao or ''])

            details_tbl = Table(details_data)
            elements.append(details_tbl)

        elements.append(Spacer(1, 0.2*inch))

    if ncs:
        total_valor_geral = sum(nc.valor for nc in ncs)
        total_saldo_disponivel = sum(nc.saldo_disponivel for nc in ncs)

        elements.append(Spacer(1, 0.4*inch))
        
        total_data = [[
            Paragraph(f"<b>TOTAL GERAL (VALOR ORIGINAL):</b> R$ {total_valor_geral:,.2f}", styles['Normal']),
            Paragraph(f"<b>TOTAL GERAL (SALDO DISPONÍVEL):</b> R$ {total_saldo_disponivel:,.2f}", styles['Normal']),
        ]]
        
        total_tbl = Table(total_data, colWidths=[5.4*inch, 5.4*inch])
        total_tbl.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.lightgrey),
            ('GRID', (0,0), (-1,-1), 1, colors.black),
            ('BOX', (0,0), (-1,-1), 2, colors.black),
        ]))
        elements.append(total_tbl)

    if not ncs:
        elements.append(Paragraph("Nenhuma Nota de Crédito encontrada para os filtros selecionados.", styles['Normal']))
    
    doc.build(elements)
    buffer.seek(0)
    
    headers = {'Content-Disposition': 'inline; filename="relatorio_salc.pdf"'}
    log_audit_action(db, current_user.username, "REPORT_GENERATED", f"Filtros: PI={plano_interno}, ND={nd}, Seção={secao_responsavel_id}, Status={status}")
    db.commit()
    return Response(content=buffer.getvalue(), media_type='application/pdf', headers=headers)

# --- AUDITORIA ---

@app.get("/audit-logs", response_model=List[AuditLogInDB], summary="Retorna o log de auditoria do sistema", tags=["Auditoria"])
def read_audit_logs(
    skip: int = 0, limit: int = 100, db: Session = Depends(get_db),
    admin_user: User = Depends(get_current_admin_user)
):
    logs = db.query(AuditLog).order_by(desc(AuditLog.timestamp)).offset(skip).limit(limit).all()
    return logs
