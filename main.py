import os
import io
import enum
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, status, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator, Field, EmailStr
from sqlalchemy import create_engine, Column, Integer, String, Float, Date, ForeignKey, DateTime, Enum as SQLAlchemyEnum
from sqlalchemy.orm import sessionmaker, Session, relationship
from sqlalchemy.exc import IntegrityError
from sqlalchemy.sql import func

# --- Segurança e Autenticação ---
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

# ==============================================================================
# 1. CONFIGURAÇÃO INICIAL E DE SEGURANÇA
# ==============================================================================

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60  # Token expira em 1 hora

if SECRET_KEY is None:
    raise RuntimeError("FATAL: A variável de ambiente SECRET_KEY não está configurada.")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# ==============================================================================
# 2. CONFIGURAÇÃO DO BANCO DE DADOS
# ==============================================================================

DATABASE_URL = os.getenv("DATABASE_URL")
if DATABASE_URL is None:
    raise RuntimeError("FATAL: A variável de ambiente DATABASE_URL não está configurada.")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

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

class NotaCredito(Base):
    __tablename__ = "notas_credito"
    id = Column(Integer, primary_key=True, index=True)
    numero_nc = Column(String, unique=True, nullable=False) # Adicionado para unicidade
    valor = Column(Float, nullable=False)
    esfera = Column(String)
    fonte = Column(String(10))
    ptres = Column(String(6))
    plano_interno = Column(String, index=True)
    nd = Column(String(6), index=True)
    data_chegada = Column(Date)
    prazo_empenho = Column(Date)
    descricao = Column(String)
    secao_responsavel_id = Column(Integer, ForeignKey("secoes.id"), index=True)
    saldo_disponivel = Column(Float, nullable=False)
    status = Column(String, default="Ativa", index=True)
    
    secao_responsavel = relationship("Seção", back_populates="notas_credito")
    empenhos = relationship("Empenho", back_populates="nota_credito", cascade="all, delete-orphan")

class Empenho(Base):
    __tablename__ = "empenhos"
    id = Column(Integer, primary_key=True, index=True)
    numero_ne = Column(String, unique=True, nullable=False)
    valor = Column(Float, nullable=False)
    data_empenho = Column(Date)
    observacao = Column(String)
    nota_credito_id = Column(Integer, ForeignKey("notas_credito.id"))
    secao_requisitante_id = Column(Integer, ForeignKey("secoes.id")) # Herdado da NC
    
    nota_credito = relationship("NotaCredito", back_populates="empenhos")
    secao_requisitante = relationship("Seção")

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    username = Column(String, nullable=False)
    action = Column(String, nullable=False)
    details = Column(String)

# ==============================================================================
# 4. SCHEMAS DE DADOS (Pydantic)
# ==============================================================================

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[str] = None

class UserBase(BaseModel):
    username: str
    email: EmailStr

class UserCreate(UserBase):
    password: str
    role: UserRole

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
    class Config:
        from_attributes = True

class NotaCreditoBase(BaseModel):
    numero_nc: str
    valor: float = Field(..., gt=0)
    esfera: Optional[str] = None
    fonte: Optional[str] = Field(None, max_length=10)
    ptres: Optional[str] = Field(None, max_length=6)
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
        
class AuditLogInDB(BaseModel):
    id: int
    timestamp: datetime
    username: str
    action: str
    details: Optional[str] = None
    class Config:
        from_attributes = True

# ==============================================================================
# 5. UTILITÁRIOS E DEPENDÊNCIAS
# ==============================================================================

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def create_audit_log(db: Session, user: User, action: str, details: str = ""):
    log_entry = AuditLog(username=user.username, action=action, details=details)
    db.add(log_entry)
    db.flush() # Garante que o log seja escrito mesmo antes do commit final

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=15))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciais inválidas", headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None: raise credentials_exception
        token_data = TokenData(username=username)
    except JWTError:
        raise credentials_exception
    user = db.query(User).filter(User.username == token_data.username).first()
    if user is None:
        raise credentials_exception
    return user

async def get_current_operator_user(current_user: User = Depends(get_current_user)):
    if current_user.role not in [UserRole.OPERADOR, UserRole.ADMINISTRADOR]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Ação requer perfil de Operador ou superior.")
    return current_user

async def get_current_admin_user(current_user: User = Depends(get_current_user)):
    if current_user.role != UserRole.ADMINISTRADOR:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Ação requer perfil de Administrador.")
    return current_user

# ==============================================================================
# 6. APLICAÇÃO FastAPI E EVENTO DE STARTUP
# ==============================================================================

app = FastAPI(
    title="Sistema de Gestão de Notas de Crédito",
    description="API para controle de execução orçamentária do 2º CGEO.",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    print("Iniciando aplicação e verificando banco de dados...")
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        if db.query(User).count() == 0:
            print("Nenhum usuário encontrado. Tentando criar o administrador inicial...")
            initial_admin_user = os.getenv("INITIAL_ADMIN_USER")
            initial_admin_email = os.getenv("INITIAL_ADMIN_EMAIL")
            initial_admin_pass = os.getenv("INITIAL_ADMIN_PASSWORD")
            
            if all([initial_admin_user, initial_admin_email, initial_admin_pass]):
                hashed_password = get_password_hash(initial_admin_pass)
                admin_user = User(
                    username=initial_admin_user,
                    email=initial_admin_email,
                    hashed_password=hashed_password,
                    role=UserRole.ADMINISTRADOR
                )
                db.add(admin_user)
                db.commit()
                print(f"SUCESSO: Usuário administrador '{initial_admin_user}' criado.")
            else:
                print("AVISO: Variáveis de ambiente para o admin inicial não configuradas. Nenhum usuário foi criado.")
    finally:
        db.close()
    print("Aplicação iniciada com sucesso.")

# ==============================================================================
# 7. ENDPOINTS DA API
# ==============================================================================

@app.get("/", summary="Verificação de status da API")
def read_root():
    return {"status": "API de Gestão de Notas de Crédito no ar."}

# --- Autenticação ---
@app.post("/token", response_model=Token, summary="Autentica o usuário e retorna um token JWT")
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuário ou senha incorretos")
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role.value}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

# --- Usuários ---
@app.get("/users/me", response_model=UserInDB, summary="Retorna informações do usuário logado")
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user

# --- Seções ---
@app.get("/secoes", response_model=List[SeçãoInDB], summary="Lista todas as seções")
def read_secoes(db: Session = Depends(get_db), current_user: User = Depends(get_current_operator_user)):
    return db.query(Seção).order_by(Seção.nome).all()

# --- Notas de Crédito ---
@app.post("/notas-credito", response_model=NotaCreditoInDB, status_code=status.HTTP_201_CREATED, summary="Cadastra uma nova Nota de Crédito")
def create_nota_credito(nc: NotaCreditoCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_operator_user)):
    db_secao = db.query(Seção).filter(Seção.id == nc.secao_responsavel_id).first()
    if not db_secao:
        raise HTTPException(status_code=404, detail="Seção responsável não encontrada.")

    try:
        db_nc = NotaCredito(**nc.dict(), saldo_disponivel=nc.valor, status="Ativa")
        db.add(db_nc)
        create_audit_log(db, current_user, "CRIAR NC", f"NC '{nc.numero_nc}' criada com valor R$ {nc.valor:,.2f} para a seção '{db_secao.nome}'.")
        db.commit()
        db.refresh(db_nc)
        return db_nc
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Uma Nota de Crédito com este número já existe.")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Ocorreu um erro inesperado: {e}")

# ... (Endpoints GET, PUT, DELETE para NCs, e todos os outros endpoints para Empenhos, Anulações,
# Recolhimentos, Dashboard, Relatórios e Logs de Auditoria seriam adicionados aqui,
# seguindo o mesmo padrão de validação, lógica de negócio e segurança.)
